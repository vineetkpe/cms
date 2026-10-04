(() => {
  const init = () => {
    const editorCard = document.querySelector('.editor-card');
    if (!editorCard || document.querySelector('#cmsAiAssistant')) return;

    const style = document.createElement('style');
    style.textContent = `
      .ai-card{background:linear-gradient(180deg,#fff 0%,#fbfcff 100%);border:1px solid #dce5f4;border-radius:13px;padding:17px;box-shadow:0 6px 24px rgba(23,105,224,.05)}
      .ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ai-head strong{font-size:.9rem}.ai-badge{font-size:.68rem;font-weight:800;color:#175cd3;background:#eff8ff;border:1px solid #b2ddff;border-radius:999px;padding:4px 7px;white-space:nowrap}
      .ai-actions{display:flex;gap:7px;flex-wrap:wrap}.ai-action{border:1px solid #d8dee8;background:#fff;color:#344054;border-radius:8px;padding:7px 9px;font:inherit;font-size:.76rem;font-weight:750;cursor:pointer}.ai-action:hover{border-color:#84adff;background:#f8fbff}.ai-action.active{background:#1769e0;color:#fff;border-color:#1769e0}
      .ai-prompt{width:100%;min-height:76px;resize:vertical;border:1px solid #d8dee8;border-radius:8px;padding:10px 11px;font:inherit}.ai-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ai-run{background:#1769e0;color:#fff;border:0;border-radius:8px;padding:9px 13px;font:inherit;font-weight:800;cursor:pointer}.ai-run:disabled{opacity:.55;cursor:wait}
      .ai-result{display:none;border:1px solid #d8dee8;background:#fff;border-radius:9px;padding:12px;white-space:pre-wrap;line-height:1.58;font-size:.85rem;max-height:360px;overflow:auto}.ai-result.show{display:block}.ai-status{font-size:.72rem;color:#667085}.ai-use{display:none;gap:7px;flex-wrap:wrap}.ai-use.show{display:flex}.ai-use button{border:1px solid #d8dee8;background:#fff;border-radius:8px;padding:7px 9px;font:inherit;font-size:.75rem;font-weight:750;cursor:pointer}.ai-note{font-size:.72rem;color:#667085;line-height:1.45}
    `;
    document.head.appendChild(style);

    const card = document.createElement('div');
    card.id = 'cmsAiAssistant';
    card.className = 'ai-card';
    card.innerHTML = `
      <div class="ai-head"><div><strong>AI writing assistant</strong><div class="ai-note">Ask for ideas, outlines, SEO suggestions, rewrites or help continuing the draft. Nothing is inserted until you choose to use it.</div></div><span class="ai-badge" id="aiProvider">AI</span></div>
      <div class="ai-actions" style="margin-top:12px">
        <button type="button" class="ai-action" data-ai-action="ideas">Topic ideas</button>
        <button type="button" class="ai-action" data-ai-action="outline">Outline</button>
        <button type="button" class="ai-action" data-ai-action="titles">Titles</button>
        <button type="button" class="ai-action" data-ai-action="seo">SEO review</button>
        <button type="button" class="ai-action" data-ai-action="improve">Improve draft</button>
        <button type="button" class="ai-action" data-ai-action="continue">Continue writing</button>
      </div>
      <textarea class="ai-prompt" id="aiPrompt" placeholder="Or ask anything about this article…" style="margin-top:10px"></textarea>
      <div class="ai-row" style="margin-top:9px"><button type="button" class="ai-run" id="aiRun">Ask AI</button><span class="ai-status" id="aiStatus">Uses the current title, SEO fields and article draft as context.</span></div>
      <div class="ai-result" id="aiResult" style="margin-top:11px"></div>
      <div class="ai-use" id="aiUse" style="margin-top:8px"><button type="button" id="aiInsert">Insert at end</button><button type="button" id="aiReplace">Replace article</button><button type="button" id="aiCopy">Copy</button></div>
    `;
    editorCard.parentNode.insertBefore(card, editorCard);

    let action = 'ask';
    let latest = '';
    const buttons = [...card.querySelectorAll('[data-ai-action]')];
    const prompt = card.querySelector('#aiPrompt');
    const run = card.querySelector('#aiRun');
    const result = card.querySelector('#aiResult');
    const use = card.querySelector('#aiUse');
    const status = card.querySelector('#aiStatus');
    const provider = card.querySelector('#aiProvider');

    buttons.forEach((button) => button.addEventListener('click', () => {
      const next = button.getAttribute('data-ai-action') || 'ask';
      action = action === next ? 'ask' : next;
      buttons.forEach((item) => item.classList.toggle('active', item.getAttribute('data-ai-action') === action));
    }));

    async function askAi() {
      if (!(run instanceof HTMLButtonElement) || !(prompt instanceof HTMLTextAreaElement)) return;
      run.disabled = true;
      run.textContent = 'Thinking…';
      if (status) status.textContent = 'Generating suggestion…';
      try {
        const body = window.cmsEditor?.getMarkdown?.() || '';
        const response = await fetch('/api/admin/ai', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            prompt: prompt.value,
            title: document.querySelector('#title')?.value || '',
            description: document.querySelector('#description')?.value || '',
            focusKeyword: document.querySelector('#focusKeyword')?.value || '',
            category: document.querySelector('#category')?.value || '',
            article: body,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'AI request failed.');
        latest = String(data.text || '').trim();
        if (!latest) throw new Error('AI returned an empty response.');
        if (result) { result.textContent = latest; result.classList.add('show'); }
        if (use) use.classList.add('show');
        if (provider) provider.textContent = data.provider || 'AI';
        if (status) status.textContent = `${data.provider || 'AI'} · ${data.model || 'assistant'}`;
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Unable to generate suggestion.';
        if (window.cmsNotice) window.cmsNotice(error instanceof Error ? error.message : 'Unable to generate suggestion.', false);
      } finally {
        run.disabled = false;
        run.textContent = 'Ask AI';
      }
    }

    run?.addEventListener('click', askAi);
    prompt?.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') askAi();
    });

    card.querySelector('#aiInsert')?.addEventListener('click', () => {
      if (!latest || !window.cmsEditor) return;
      const current = window.cmsEditor.getMarkdown?.() || '';
      window.cmsEditor.setMarkdown?.(`${current}${current.trim() ? '\n\n' : ''}${latest}`, false);
      window.cmsNotice?.('AI suggestion inserted. Review it before publishing.');
    });
    card.querySelector('#aiReplace')?.addEventListener('click', () => {
      if (!latest || !window.cmsEditor) return;
      if (!confirm('Replace the entire article body with this AI suggestion?')) return;
      window.cmsEditor.setMarkdown?.(latest, false);
      window.cmsNotice?.('Article body replaced. Review it before publishing.');
    });
    card.querySelector('#aiCopy')?.addEventListener('click', async () => {
      if (!latest) return;
      await navigator.clipboard.writeText(latest).catch(() => {});
      if (status) status.textContent = 'Copied to clipboard.';
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
