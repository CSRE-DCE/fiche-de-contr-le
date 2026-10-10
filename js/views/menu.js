/* Menu complet (téléphone) : accès à tous les écrans, regroupés comme la navigation latérale. */
import { html } from '../core/util.js';
import { session } from '../core/session.js';
import { ROLES } from '../core/auth.js';
import { pageTitle } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { navItems } from './shell.js';

const entry = (href, ic, label) => html`<a class="li" href="${href}"><span class="li-ic">${icon(ic, { size: 24 })}</span><div class="li-main"><div class="li-title">${label}</div></div><span class="chev">${icon('chevron-right', { size: 20 })}</span></a>`;

export default {
  nav: 'menu', title: 'Menu',
  async render() {
    const items = navItems();
    const groups = [...new Set(items.map(n => n.group))];
    return html`${pageTitle('Menu', `${session.user.name} — ${ROLES[session.user.role]}`)}
      ${groups.map(g => html`<div class="date-head">${g}</div><div class="list">${items.filter(n => n.group === g).map(n => entry(n.href, n.ic, n.label))}</div>`)}
      <div class="date-head">Session</div><div class="list">${entry('#/compte', 'user', 'Mon compte et affichage')}</div>`;
  }
};
