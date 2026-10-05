// Review view: document list, rendered markdown, comment panel, approve. Writes go through the server only.
const AUTHOR_KEY = 'taskify.author';
const KIND_ORDER = ['plan', 'index', 'spec', 'progress'];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  globalThis.marked.use({
    renderer: {
      // marked does not sanitise: raw HTML (block or inline) is shown as text.
      html(token) { return escapeHtml(token.text ?? token.raw ?? ''); },
      heading({ tokens, text, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth > 3) return `<h${depth}>${inner}</h${depth}>\n`;
        return `<h${depth} id="${escapeHtml(slug(text))}">${inner} `
          + `<button type="button" class="comment-btn" data-anchor="${escapeHtml(text)}">Comment</button></h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!/^(https?:|mailto:|#|\/|\.|[\w-]+(\/|\.|$))/i.test(href ?? '')) return inner; // javascript:, data: etc. fail the allow-list
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</a>`;
      },
    },
  });
}

export function renderMarkdown(md) {
  configure();
  return globalThis.marked.parse(String(md ?? ''));
}

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

const str = (v) => (typeof v === 'string' ? v : '');
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? str(iso) : d.toLocaleString(); };

function readAuthor() {
  try { return localStorage.getItem(AUTHOR_KEY) ?? ''; } catch { return ''; }
}
function writeAuthor(v) {
  try { localStorage.setItem(AUTHOR_KEY, v); } catch { /* storage unavailable */ }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  let message = `${res.status}`;
  try { message = (await res.json()).error ?? message; } catch { /* not JSON */ }
  throw new Error(message);
}

export async function mount(root, { planId, api, onPoll }) {
  const q = `plan=${encodeURIComponent(planId)}`;
  let plan = { docs: [], review: { comments: [], approvals: [] } };
  let file = null;
  let anchor = null;
  let showResolved = false;
  let seq = 0;
  let lastDoc = null;
  let lastKey = '';

  // ---- header: approval ----
  const approvalText = el('span', { class: 'approval-text' });
  const approveBtn = el('button', { type: 'button', id: 'approve-btn' }, 'Approve plan');
  const approveError = el('span', { class: 'form-error', role: 'alert' });
  const authorInput = el('input', { type: 'text', id: 'author', maxlength: '60', placeholder: 'Your name', 'aria-label': 'Your name' });
  authorInput.value = readAuthor();
  authorInput.addEventListener('input', () => writeAuthor(authorInput.value));
  const bar = el('div', { class: 'review-bar' }, approvalText, authorInput, approveBtn, approveError);

  // ---- panes ----
  const docList = el('ul', { class: 'doc-list' });
  const article = el('article', { class: 'doc', id: 'doc' });
  const commentList = el('ul', { class: 'comments' });
  const resolvedToggle = el('input', { type: 'checkbox', id: 'show-resolved' });
  const anchorLabel = el('p', { class: 'anchor-label' });
  const clearAnchor = el('button', { type: 'button', class: 'link-btn' }, 'Whole file instead');
  const textarea = el('textarea', { id: 'comment-text', rows: '4', maxlength: '4000', 'aria-label': 'Comment' });
  const submit = el('button', { type: 'submit', id: 'comment-submit' }, 'Add comment');
  const formError = el('p', { class: 'form-error', role: 'alert' });
  const form = el('form', { class: 'comment-form', id: 'comment-form' }, anchorLabel, clearAnchor, textarea, submit, formError);
  const panel = el('aside', { class: 'panel' },
    el('h2', {}, 'Comments'),
    el('label', { class: 'toggle' }, resolvedToggle, ' Show resolved'),
    commentList, form);
  root.replaceChildren(bar, el('div', { class: 'review-layout' },
    el('nav', { class: 'docs' }, el('h2', {}, 'Documents'), docList), article, panel));

  function setAnchor(a) {
    anchor = a;
    anchorLabel.textContent = a === null ? 'Commenting on the whole file' : `Commenting on: ${a}`;
    clearAnchor.hidden = a === null;
  }
  setAnchor(null);

  const forFile = () => plan.review.comments.filter((c) => c.file === file);

  function renderApproval() {
    const list = plan.review.approvals;
    const last = list.length ? list[list.length - 1] : null;
    approvalText.textContent = last ? `Approved by ${str(last.by) || 'browser'} at ${when(last.at)}` : 'Not approved yet';
  }

  function renderDocList() {
    docList.replaceChildren(...plan.docs.map((d) => {
      const open = plan.review.comments.filter((c) => c.file === d.path && !c.resolved).length;
      const btn = el('button', { type: 'button', class: d.path === file ? 'doc-btn active' : 'doc-btn', 'data-path': d.path });
      btn.append(el('span', { class: 'doc-name' }, d.path));
      if (open) btn.append(el('span', { class: 'badge' }, String(open)));
      btn.addEventListener('click', () => selectFile(d.path));
      return el('li', {}, btn);
    }));
  }

  function renderComments() {
    const all = forFile();
    const shown = [...all.filter((c) => !c.resolved), ...(showResolved ? all.filter((c) => c.resolved) : [])];
    commentList.replaceChildren(...(shown.length ? shown.map((c) => {
      const head = el('div', { class: 'comment-head' });
      head.append(el('strong', {}, str(c.author) || 'browser'), ` · ${when(c.created)}`);
      const li = el('li', { class: c.resolved ? 'comment resolved' : 'comment', 'data-id': str(c.id) }, head);
      if (c.anchor) li.append(el('div', { class: 'comment-anchor' }, `On: ${c.anchor}`));
      li.append(el('p', { class: 'comment-text' }, str(c.text)));
      if (c.resolved) li.append(el('div', { class: 'comment-resolution' }, `Resolved by ${str(c.resolved_by) || 'unknown'}${c.resolution_note ? `: ${c.resolution_note}` : ''}`));
      return li;
    }) : [el('li', { class: 'empty' }, 'No comments.')]));
  }

  async function loadDoc() {
    const mine = ++seq;
    if (!file) { article.replaceChildren(el('p', { class: 'empty' }, 'No documents.')); return; }
    const md = await api(`/api/file?${q}&path=${encodeURIComponent(file)}`);
    if (mine !== seq || md === lastDoc) return;
    lastDoc = md;
    article.innerHTML = renderMarkdown(md); // marked output with raw HTML escaped by the renderer override
  }

  function selectFile(path) {
    file = path;
    lastDoc = null;
    setAnchor(null);
    renderDocList();
    renderComments();
    loadDoc().catch((err) => article.replaceChildren(el('p', { class: 'unavailable' }, `Could not load ${path}: ${err.message}`)));
  }

  async function refresh() {
    const data = await api(`/api/plan?${q}`);
    const key = JSON.stringify([data.docs, data.review]);
    plan = {
      // plan docs, specs README, specs, then PROGRESS.md (server order is stable within a kind)
      docs: (Array.isArray(data.docs) ? data.docs : [])
        .map((d, i) => ({ d, i, r: KIND_ORDER.indexOf(d.kind) }))
        .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.d),
      review: { comments: data.review?.comments ?? [], approvals: data.review?.approvals ?? [] },
    };
    if (file === null || !plan.docs.some((d) => d.path === file)) {
      file = plan.docs[0]?.path ?? null;
      lastDoc = null;
    }
    if (key !== lastKey) {
      lastKey = key;
      renderApproval();
      renderDocList();
      renderComments();
    }
    await loadDoc(); // form and its half-typed text are never rebuilt here
  }

  // ---- events ----
  article.addEventListener('click', (ev) => {
    const btn = ev.target.closest?.('.comment-btn');
    if (!btn) return;
    setAnchor(btn.getAttribute('data-anchor'));
    textarea.focus();
  });
  clearAnchor.addEventListener('click', () => setAnchor(null));
  resolvedToggle.addEventListener('change', () => { showResolved = resolvedToggle.checked; renderComments(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    formError.textContent = '';
    submit.disabled = true;
    try {
      await postJson('/api/comments', { plan: planId, file, anchor, text: textarea.value, author: authorInput.value });
      textarea.value = '';
      setAnchor(null);
      await refresh();
    } catch (err) {
      formError.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  approveBtn.addEventListener('click', async () => {
    approveError.textContent = '';
    approveBtn.disabled = true;
    try {
      await postJson('/api/approve', { plan: planId, note: '', author: authorInput.value });
      await refresh();
    } catch (err) {
      approveError.textContent = err.message;
    } finally {
      approveBtn.disabled = false;
    }
  });

  await refresh();
  onPoll(refresh);
}
