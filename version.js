/* Numéro de version UNIQUE de l'application, lu à la fois par la page (index.html) et par le service
 * worker (sw.js, qui en déduit le nom de son cache).
 *
 * À INCRÉMENTER À CHAQUE PUBLICATION d'une modification de l'application (python tools/bump_version.py) :
 * les appareils détectent alors la nouvelle version et remplacent leur cache. La vérification automatique
 * (tools/check_release.py, lancée par GitHub Actions) refuse une modification sans changement ici.
 *
 * La version est aussi enregistrée dans chaque audit (« version de l'application »).
 */
self.AUDIT_BUILD = 7;
self.AUDIT_BUILD_DATE = '2026-10-11';
self.AUDIT_VERSION = '1.0.' + self.AUDIT_BUILD;
