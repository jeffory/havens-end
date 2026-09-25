/**
 * When this build was made, and from which commit, small in the bottom right corner:
 * enough to tell which version is running.
 */
export function buildStamp(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'build-stamp';
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD__.time));
  el.textContent = [import.meta.env.DEV ? 'dev' : null, when, __BUILD__.commit || null].filter(Boolean).join(' · ');
  el.title = `Built ${__BUILD__.time}${__BUILD__.commit ? ` from ${__BUILD__.commit}` : ''}`;
  parent.append(el);
}
