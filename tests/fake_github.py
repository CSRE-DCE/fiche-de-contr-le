"""Faux serveur de l'API REST GitHub, en mémoire, pour tester la synchronisation d'équipe sans réseau.

Reproduit fidèlement le sous-ensemble utilisé par js/app/github.js :
  GET  /user                                   compte du jeton (401 si jeton inconnu)
  GET  /repos/{o}/{r}                          dépôt (404 si inconnu ou inaccessible avec ce jeton)
  GET  /repos/{o}/{r}/git/ref/heads/{branche}  409 « Git Repository is empty. » sur un dépôt sans commit
  GET  /repos/{o}/{r}/git/commits/{sha}        GET .../git/trees/{sha}[?recursive=1]   GET .../git/blobs/{sha}
  POST /repos/{o}/{r}/git/blobs | git/trees (base_tree, content en ligne, sha null = suppression) | git/commits
  PATCH /repos/{o}/{r}/git/refs/heads/{branche}  refus 422 « Update is not a fast forward » (force: false)
  POST /repos/{o}/{r}/git/refs                 PUT /repos/{o}/{r}/contents/{chemin} (seule écriture sur un dépôt vide)
Les objets git (blob, tree, commit) ont leurs empreintes SHA-1 EXACTES (mêmes sha que git). En-têtes CORS
et X-RateLimit-* comme api.github.com ; simulation de la limite de débit (rate_limit_remaining = 0).

Utilisation dans les tests (même processus) :
    fake = FakeGitHub(tokens={'tok-a': 'alice'}, repos=['oeg/donnees']).start()
    fake.url  → 'http://127.0.0.1:<port>'  … fake.read_json('donnees/config/equipe.json') … fake.stop()
Ou seul, pour un essai manuel :  python tests/fake_github.py --port 8899 --token tok-a:alice --repo oeg/donnees
"""
import argparse
import base64
import hashlib
import json
import re
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BLOB_MODE, TREE_MODE = '100644', '040000'


class GitObjects:
    """Magasin d'objets git (empreintes SHA-1 exactes)."""

    def __init__(self):
        self.raw = {}        # sha → (type, contenu brut)
        self.trees = {}      # sha → {nom: (mode, type, sha)}
        self.commits = {}    # sha → dict

    def _put(self, kind, payload):
        sha = hashlib.sha1(f'{kind} {len(payload)}\0'.encode() + payload).hexdigest()
        self.raw[sha] = (kind, payload)
        return sha

    def blob(self, data):
        return self._put('blob', data)

    def tree(self, entries):
        """entries : {nom: (mode, type, sha)} — tri git (les dossiers comparés avec « / » final)."""
        items = sorted(entries.items(), key=lambda kv: kv[0].encode() + (b'/' if kv[1][1] == 'tree' else b''))
        payload = b''.join(f"{'40000' if typ == 'tree' else mode} {name}".encode() + b'\0' + bytes.fromhex(sha)
                           for name, (mode, typ, sha) in items)
        sha = self._put('tree', payload)
        self.trees[sha] = dict(entries)
        return sha

    def commit(self, tree, parents, message, name='Fake GitHub', email='fake@example.invalid', ts=None):
        ts = int(ts or time.time())
        lines = [f'tree {tree}'] + [f'parent {p}' for p in parents]
        lines += [f'author {name} <{email}> {ts} +0000', f'committer {name} <{email}> {ts} +0000', '', message]
        sha = self._put('commit', '\n'.join(lines).encode())
        self.commits[sha] = {'tree': tree, 'parents': list(parents), 'message': message, 'name': name, 'email': email, 'ts': ts}
        return sha

    def flatten(self, tree_sha, prefix=''):
        """{chemin: sha de blob} de tout un arbre."""
        out = {}
        for name, (mode, typ, sha) in self.trees.get(tree_sha, {}).items():
            if typ == 'tree':
                out.update(self.flatten(sha, prefix + name + '/'))
            else:
                out[prefix + name] = sha
        return out

    def build(self, files):
        """Arbre à partir de {chemin: sha de blob}."""
        root = {}
        for path, sha in files.items():
            node = root
            parts = path.split('/')
            for p in parts[:-1]:
                node = node.setdefault(p, {})
                if not isinstance(node, dict):
                    raise ValueError(f'conflit de chemin : {path}')
            node[parts[-1]] = sha

        def make(node):
            entries = {}
            for name, v in node.items():
                entries[name] = (TREE_MODE, 'tree', make(v)) if isinstance(v, dict) else (BLOB_MODE, 'blob', v)
            return self.tree(entries)
        return make(root)


class FakeGitHub:
    def __init__(self, tokens=None, repos=('oeg/donnees',), private=True, host='127.0.0.1', port=0):
        # tokens : {jeton: login} ; repos : 'propriétaire/nom' (accessibles à tous les jetons, sauf restriction)
        self.tokens = {t: {'login': l, 'id': 1000 + i, 'name': l.replace('-', ' ').title()} for i, (t, l) in enumerate((tokens or {'tok-test': 'oeg-test'}).items())}
        self.git = GitObjects()
        self.repos = {}
        for r in repos:
            self.add_repo(r, private=private)
        self.host, self.port = host, port
        self.lock = threading.RLock()
        self.stats = Counter()
        self.log = []
        self.rate_limit_remaining = 5000
        self.before_ref_update = None    # appelé (une fois) avant le traitement d'une mise à jour de branche
        self.server = None

    # ---------- gestion ----------
    def add_repo(self, full, private=True, default_branch='main', allowed=None):
        owner, name = full.split('/')
        self.repos[full.lower()] = {'owner': owner, 'name': name, 'private': private, 'default_branch': default_branch, 'refs': {}, 'allowed': allowed}
        return self.repos[full.lower()]

    def start(self):
        fake = self

        class Handler(_Handler):
            pass
        Handler.fake = fake
        self.server = ThreadingHTTPServer((self.host, self.port), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    @property
    def url(self):
        return f'http://{self.host}:{self.port}'

    # ---------- aides pour les tests ----------
    def repo(self, full='oeg/donnees'):
        return self.repos[full.lower()]

    def head(self, branch='main', full='oeg/donnees'):
        return self.repo(full)['refs'].get(branch)

    def files(self, branch='main', full='oeg/donnees'):
        h = self.head(branch, full)
        return self.git.flatten(self.git.commits[h]['tree']) if h else {}

    def read(self, path, branch='main', full='oeg/donnees'):
        sha = self.files(branch, full).get(path)
        return self.git.raw[sha][1] if sha else None

    def read_json(self, path, branch='main', full='oeg/donnees'):
        b = self.read(path, branch, full)
        return json.loads(b.decode('utf-8')) if b is not None else None

    def list(self, prefix='', branch='main', full='oeg/donnees'):
        return sorted(p for p in self.files(branch, full) if p.startswith(prefix))

    def commit_files(self, changes, message='Modification externe', branch='main', full='oeg/donnees'):
        """Commit direct (autre appareil, administrateur sur github.com…) : {chemin: octets | texte | objet JSON | None (suppression)}."""
        with self.lock:
            r = self.repo(full)
            h = r['refs'].get(branch)
            files = self.git.flatten(self.git.commits[h]['tree']) if h else {}
            for path, v in changes.items():
                if v is None:
                    files.pop(path, None)
                    continue
                data = v if isinstance(v, bytes) else v.encode('utf-8') if isinstance(v, str) else (json.dumps(v, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
                files[path] = self.git.blob(data)
            sha = self.git.commit(self.git.build(files), [h] if h else [], message)
            r['refs'][branch] = sha
            return sha

    def history(self, branch='main', full='oeg/donnees'):
        out, h = [], self.head(branch, full)
        while h:
            c = self.git.commits[h]
            out.append({'sha': h, **c})
            h = c['parents'][0] if c['parents'] else None
        return out

    def is_ancestor(self, old, new):
        seen, todo = set(), [new]
        while todo:
            s = todo.pop()
            if s == old:
                return True
            if s in seen or s not in self.git.commits:
                continue
            seen.add(s)
            todo.extend(self.git.commits[s]['parents'])
        return False


def _b64_lines(data):
    s = base64.b64encode(data).decode()
    return '\n'.join(s[i:i + 60] for i in range(0, len(s), 60)) + ('\n' if s else '')


class _Handler(BaseHTTPRequestHandler):
    fake = None
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    # ---------- réponses ----------
    def _headers(self, status, length, ctype='application/json; charset=utf-8', extra=None):
        f = self.fake
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Expose-Headers', 'ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-GitHub-Request-Id')
        self.send_header('X-RateLimit-Limit', '5000')
        self.send_header('X-RateLimit-Remaining', str(max(0, f.rate_limit_remaining)))
        self.send_header('X-RateLimit-Reset', str(int(time.time()) + 3600))
        self.send_header('X-GitHub-Api-Version-Selected', '2022-11-28')
        self.send_header('Cache-Control', 'private, max-age=60, s-maxage=60')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, status, obj, extra=None):
        body = json.dumps(obj).encode('utf-8')
        self._headers(status, len(body), extra=extra)
        self.wfile.write(body)

    def _error(self, status, message):
        self._json(status, {'message': message, 'documentation_url': 'https://docs.github.com/rest', 'status': str(status)})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-GitHub-Api-Version, If-None-Match, If-Modified-Since')
        self.send_header('Access-Control-Max-Age', '86400')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        self._dispatch('GET')

    def do_POST(self):
        self._dispatch('POST')

    def do_PATCH(self):
        self._dispatch('PATCH')

    def do_PUT(self):
        self._dispatch('PUT')

    # ---------- routage ----------
    def _dispatch(self, method):
        f = self.fake
        u = urlparse(self.path)
        path, query = unquote(u.path), parse_qs(u.query)
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        try:
            body = json.loads(raw.decode('utf-8')) if raw else {}
        except ValueError:
            return self._error(400, 'Problems parsing JSON')
        with f.lock:
            f.stats['requests'] += 1
            f.log.append((method, path))
            if f.rate_limit_remaining <= 0:
                f.stats['rate_limited'] += 1
                return self._error(403, 'API rate limit exceeded for user ID 1000.')
            f.rate_limit_remaining -= 1
            auth = self.headers.get('Authorization') or ''
            m = re.match(r'^(?:Bearer|token)\s+(.+)$', auth)
            user = f.tokens.get(m.group(1).strip()) if m else None
            if m and not user:
                return self._error(401, 'Bad credentials')
            if path == '/user' and method == 'GET':
                if not user:
                    return self._error(401, 'Requires authentication')
                return self._json(200, {'login': user['login'], 'id': user['id'], 'name': user['name'], 'type': 'User'})
            m = re.match(r'^/repos/([^/]+)/([^/]+)(/.*)?$', path)
            if not m:
                return self._error(404, 'Not Found')
            r = f.repos.get(f'{m.group(1)}/{m.group(2)}'.lower())
            if not r or (r['private'] and not user) or (r['allowed'] is not None and (not user or user['login'] not in r['allowed'])):
                return self._error(404, 'Not Found')
            return self._repo_route(method, r, m.group(3) or '', query, body, user)

    def _repo_route(self, method, r, sub, query, body, user):
        f, git = self.fake, self.fake.git
        full = f"{r['owner']}/{r['name']}"
        if sub == '' and method == 'GET':
            return self._json(200, {'id': 1, 'name': r['name'], 'full_name': full, 'private': r['private'], 'visibility': 'private' if r['private'] else 'public',
                                    'default_branch': r['default_branch'], 'owner': {'login': r['owner']}, 'html_url': f'https://github.com/{full}',
                                    'permissions': {'admin': False, 'maintain': False, 'push': True, 'triage': True, 'pull': True}, 'size': 0 if not r['refs'] else 10})
        m = re.match(r'^/git/ref/heads/(.+)$', sub)
        if m and method == 'GET':
            if not r['refs']:
                return self._error(409, 'Git Repository is empty.')
            sha = r['refs'].get(m.group(1))
            if not sha:
                return self._error(404, 'Not Found')
            return self._json(200, {'ref': f'refs/heads/{m.group(1)}', 'object': {'sha': sha, 'type': 'commit'}})
        m = re.match(r'^/git/commits/([0-9a-f]{40})$', sub)
        if m and method == 'GET':
            c = git.commits.get(m.group(1))
            if not c:
                return self._error(404, 'Not Found')
            return self._json(200, self._commit_json(m.group(1), c))
        m = re.match(r'^/git/trees/([0-9a-f]{40})$', sub)
        if m and method == 'GET':
            t = git.trees.get(m.group(1))
            if t is None:
                return self._error(404, 'Not Found')
            f.stats['trees'] += 1
            return self._json(200, {'sha': m.group(1), 'tree': self._tree_entries(m.group(1), recursive='recursive' in query), 'truncated': False})
        m = re.match(r'^/git/blobs/([0-9a-f]{40})$', sub)
        if m and method == 'GET':
            o = git.raw.get(m.group(1))
            if not o or o[0] != 'blob':
                return self._error(404, 'Not Found')
            f.stats['blobs_read'] += 1
            return self._json(200, {'sha': m.group(1), 'size': len(o[1]), 'content': _b64_lines(o[1]), 'encoding': 'base64'})
        if not user and method != 'GET':
            return self._error(401, 'Requires authentication')
        if sub == '/git/blobs' and method == 'POST':
            if not r['refs']:
                return self._error(409, 'Git Repository is empty.')
            try:
                data = base64.b64decode(body.get('content', '')) if body.get('encoding') == 'base64' else str(body.get('content', '')).encode('utf-8')
            except ValueError:
                return self._error(422, 'Invalid base64')
            f.stats['blobs_created'] += 1
            sha = git.blob(data)
            return self._json(201, {'sha': sha, 'url': ''})
        if sub == '/git/trees' and method == 'POST':
            if not r['refs']:
                return self._error(409, 'Git Repository is empty.')
            base = body.get('base_tree')
            if base and base not in git.trees:
                return self._error(422, 'Invalid tree info: base_tree')
            files = git.flatten(base) if base else {}
            for e in body.get('tree') or []:
                p = str(e.get('path', '')).strip('/')
                if not p or e.get('type', 'blob') != 'blob':
                    return self._error(422, 'Invalid tree info')
                if 'content' in e and e['content'] is not None:
                    files[p] = git.blob(str(e['content']).encode('utf-8'))
                elif e.get('sha') is None:
                    files.pop(p, None)
                    for k in [k for k in files if k.startswith(p + '/')]:
                        files.pop(k)
                elif e['sha'] in git.raw and git.raw[e['sha']][0] == 'blob':
                    files[p] = e['sha']
                else:
                    return self._error(422, f"Invalid tree info: sha {e['sha']} is not a blob")
            try:
                sha = git.build(files)
            except ValueError as err:
                return self._error(422, str(err))
            f.stats['trees_created'] += 1
            return self._json(201, {'sha': sha, 'tree': self._tree_entries(sha), 'truncated': False})
        if sub == '/git/commits' and method == 'POST':
            tree, parents = body.get('tree'), body.get('parents') or []
            if tree not in git.trees or any(p not in git.commits for p in parents):
                return self._error(422, 'Invalid tree or parent sha')
            name = (user or {}).get('name') or 'Fake GitHub'
            sha = git.commit(tree, parents, str(body.get('message', '')), name=name, email=f"{(user or {}).get('login', 'x')}@users.noreply.github.com")
            f.stats['commits'] += 1
            return self._json(201, self._commit_json(sha, git.commits[sha]))
        m = re.match(r'^/git/refs/heads/(.+)$', sub)
        if m and method == 'PATCH':
            branch, new = m.group(1), body.get('sha')
            hook, f.before_ref_update = f.before_ref_update, None
            if hook:
                hook(branch)
            cur = r['refs'].get(branch)
            if not cur:
                return self._error(422, 'Reference does not exist')
            if new not in git.commits:
                return self._error(422, 'Object does not exist')
            if not body.get('force') and not f.is_ancestor(cur, new):
                f.stats['non_ff'] += 1
                return self._error(422, 'Update is not a fast forward')
            r['refs'][branch] = new
            f.stats['ref_updates'] += 1
            return self._json(200, {'ref': f'refs/heads/{branch}', 'object': {'sha': new, 'type': 'commit'}})
        if sub == '/git/refs' and method == 'POST':
            ref, sha = str(body.get('ref', '')), body.get('sha')
            if not ref.startswith('refs/heads/') or sha not in git.commits:
                return self._error(422, 'Invalid request')
            branch = ref[len('refs/heads/'):]
            if branch in r['refs']:
                return self._error(422, 'Reference already exists')
            r['refs'][branch] = sha
            return self._json(201, {'ref': ref, 'object': {'sha': sha, 'type': 'commit'}})
        m = re.match(r'^/contents/(.+)$', sub)
        if m and method == 'PUT':
            p = m.group(1).strip('/')
            branch = body.get('branch') or r['default_branch']
            try:
                data = base64.b64decode(body.get('content', ''))
            except ValueError:
                return self._error(422, 'content is not valid Base64')
            h = r['refs'].get(branch)
            if r['refs'] and not h:
                return self._error(404, f'Branch {branch} not found')
            files = git.flatten(git.commits[h]['tree']) if h else {}
            if p in files and not body.get('sha'):
                return self._error(422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
            if p in files and body.get('sha') != files[p]:
                return self._error(409, f'{p} does not match {body.get("sha")}')
            files[p] = git.blob(data)
            sha = git.commit(git.build(files), [h] if h else [], str(body.get('message', '')), name=(user or {}).get('name', 'Fake'))
            r['refs'][branch] = sha
            f.stats['contents_put'] += 1
            return self._json(201, {'content': {'path': p, 'sha': files[p]}, 'commit': self._commit_json(sha, git.commits[sha])})
        return self._error(404, 'Not Found')

    def _commit_json(self, sha, c):
        who = {'name': c['name'], 'email': c['email'], 'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(c['ts']))}
        return {'sha': sha, 'tree': {'sha': c['tree']}, 'parents': [{'sha': p} for p in c['parents']], 'message': c['message'], 'author': who, 'committer': who}

    def _tree_entries(self, sha, recursive=False, prefix=''):
        git, out = self.fake.git, []
        for name, (mode, typ, s) in sorted(git.trees.get(sha, {}).items()):
            e = {'path': prefix + name, 'mode': mode, 'type': typ, 'sha': s}
            if typ == 'blob':
                e['size'] = len(git.raw[s][1])
            out.append(e)
            if recursive and typ == 'tree':
                out.extend(self._tree_entries(s, True, prefix + name + '/'))
        return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Faux serveur de l’API GitHub (tests de synchronisation)')
    ap.add_argument('--port', type=int, default=8899)
    ap.add_argument('--token', action='append', default=[], help='jeton:login (plusieurs possibles)')
    ap.add_argument('--repo', action='append', default=[], help='propriétaire/nom (privé)')
    a = ap.parse_args()
    tokens = dict(t.split(':', 1) for t in a.token) or {'tok-test': 'oeg-test'}
    fake = FakeGitHub(tokens=tokens, repos=a.repo or ['oeg/donnees'], port=a.port).start()
    print(f'Faux GitHub sur {fake.url} — jetons : {", ".join(tokens)} — dépôts : {", ".join(a.repo or ["oeg/donnees"])}')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        fake.stop()
