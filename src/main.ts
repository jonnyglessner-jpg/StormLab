/** App shell: hash routing between the storm and tornado views. */
import './styles/app.css';
import { mountStorm } from './views/storm/storm-view';
import { mountTornado } from './views/tornado/tornado-view';

type Mount = (root: HTMLElement) => () => void;
const VIEWS: Record<string, Mount> = { storm: mountStorm, tornado: mountTornado };

const main = document.getElementById('main')!;
let unmount: (() => void) | null = null;

function route(): void {
  let id = location.hash.replace('#', '') || 'storm';
  if (!VIEWS[id]) id = 'storm';
  if (unmount) { try { unmount(); } catch (e) { console.error(e); } unmount = null; }
  main.innerHTML = '';
  document.querySelectorAll<HTMLAnchorElement>('.modnav a').forEach(a => {
    if (a.dataset.mod === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const root = document.createElement('div');
  main.appendChild(root);
  unmount = VIEWS[id](root);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
const foot = document.getElementById('build');
if (foot) foot.textContent = `Build ${__BUILD__}`;
