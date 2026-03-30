// ==UserScript==
// @name         划词翻译 → Obsidian
// @namespace    https://github.com/MAOewoqwq
// @version      1.0
// @description  划选文字自动翻译并保存到 Obsidian 笔记
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// @connect      translate.google.com
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  // ============ 配置区域（请手动填写） ============
  const CONFIG = {
    // Obsidian Local REST API Key（在 Obsidian 设置 → Local REST API 里找）
    OBSIDIAN_API_KEY: '在这里填你的API_KEY',
    // Obsidian Local REST API 地址（默认不用改）
    OBSIDIAN_API_URL: 'http://127.0.0.1:27123',
    // 保存到哪个笔记文件（vault 内的路径）,此处填写用户自身创建的obsidian真实文件目录即可。
    NOTE_FOLDER: 'study.md/english',
    // 翻译 API 地址（Google Translate）
    TRANSLATE_API_URL: 'https://translate.googleapis.com/translate_a/single',
    // 源语言（auto = 自动检测）
    SOURCE_LANG: 'auto',
    // 目标语言
    TARGET_LANG: 'zh',
    // 选中多少字符以上才触发翻译
    MIN_LENGTH: 2,
    // 选中多少字符以上不触发（避免选中大段文字）
    MAX_LENGTH: 500,
  };

  // ============ 创建弹窗 UI ============
  function createPopup() {
    const popup = document.createElement('div');
    popup.id = 'trans-obsidian-popup';
    popup.innerHTML = `
      <div id="trans-obsidian-header">
        <span>划词翻译</span>
        <span id="trans-obsidian-close">✕</span>
      </div>
      <div id="trans-obsidian-body">
        <div class="trans-obsidian-row">
          <div id="trans-obsidian-original"></div>
          <button class="trans-obsidian-speak" id="trans-obsidian-speak-orig" title="朗读原文">🔊</button>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:6px 0;">
        <div id="trans-obsidian-result">翻译中...</div>
      </div>
      <div id="trans-obsidian-footer">
        <button id="trans-obsidian-save">保存到 Obsidian</button>
        <span id="trans-obsidian-status"></span>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #trans-obsidian-popup {
        position: fixed;
        z-index: 2147483647;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        width: 340px;
        max-height: 300px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        display: none;
        overflow: hidden;
      }
      #trans-obsidian-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #f7f7f7;
        font-weight: 600;
        font-size: 13px;
        color: #333;
      }
      #trans-obsidian-close {
        cursor: pointer;
        color: #999;
        font-size: 16px;
      }
      #trans-obsidian-close:hover { color: #333; }
      #trans-obsidian-body {
        padding: 10px 12px;
        max-height: 180px;
        overflow-y: auto;
      }
      #trans-obsidian-original {
        color: #666;
        font-size: 13px;
        line-height: 1.5;
      }
      #trans-obsidian-result {
        color: #222;
        font-size: 14px;
        line-height: 1.6;
      }
      #trans-obsidian-footer {
        padding: 8px 12px;
        background: #fafafa;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #trans-obsidian-save {
        background: #4a9eff;
        color: #fff;
        border: none;
        border-radius: 4px;
        padding: 5px 12px;
        cursor: pointer;
        font-size: 13px;
      }
      #trans-obsidian-save:hover { background: #3a8eef; }
      #trans-obsidian-save:disabled {
        background: #ccc;
        cursor: not-allowed;
      }
      #trans-obsidian-status {
        font-size: 12px;
        color: #999;
      }
      .trans-obsidian-row {
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }
      .trans-obsidian-row > div { flex: 1; }
      .trans-obsidian-speak {
        flex-shrink: 0;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 16px;
        padding: 0 2px;
        line-height: 1;
        opacity: 0.5;
        transition: opacity 0.2s;
      }
      .trans-obsidian-speak:hover { opacity: 1; }
      .trans-obsidian-speak.speaking { opacity: 1; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(popup);
    return popup;
  }

  // ============ 翻译 API 调用 ============
  function isSingleWord(text) {
    return text.split(/\s+/).length === 1 && !/[.!?;,]/.test(text);
  }

  function isPhrase(text) {
    const wordCount = text.split(/\s+/).length;
    return wordCount >= 2 && wordCount <= 5 && !/[.!?]$/.test(text.trim());
  }

  const POS_MAP = {
    noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
    pronoun: 'pron.', preposition: 'prep.', conjunction: 'conj.',
    interjection: 'int.', abbreviation: 'abbr.', article: 'art.',
  };

  function translate(text) {
    return new Promise((resolve, reject) => {
      const dtParams = isSingleWord(text) ? 'dt=t&dt=bd' : 'dt=t';
      const url = `${CONFIG.TRANSLATE_API_URL}?client=gtx&sl=${CONFIG.SOURCE_LANG}&tl=${CONFIG.TARGET_LANG}&${dtParams}&q=${encodeURIComponent(text)}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            const translated = data[0].map(item => item[0]).join('');
            let posInfo = '';
            if (isSingleWord(text) && data[1]) {
              const parts = data[1].map(entry => {
                const pos = POS_MAP[entry[0]] || entry[0];
                const meanings = entry[1].slice(0, 3).join('，');
                return `${pos}: ${meanings}`;
              });
              posInfo = parts.join('；');
            }
            const detectedLang = data[2] || CONFIG.SOURCE_LANG;
            resolve({ translated, posInfo, detectedLang });
          } catch {
            reject('解析翻译结果失败');
          }
        },
        onerror: () => reject('翻译请求失败'),
      });
    });
  }

  // ============ 保存到 Obsidian ============
  function getTodayFileName() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return { fileName: `${y}-${m}-${d}.md`, dateTitle: `${y}/${m}/${d}` };
  }

  function getVaultUrl(fileName) {
    const fullPath = `${CONFIG.NOTE_FOLDER}/${fileName}`;
    const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/');
    return `${CONFIG.OBSIDIAN_API_URL}/vault/${encodedPath}`;
  }

  function getEntryType(text, posInfo) {
    if (isSingleWord(text) && posInfo) return 'word';
    if (isPhrase(text)) return 'phrase';
    return 'sentence';
  }

  const SECTION_LABELS = {
    word: '**单词：**',
    phrase: '**词组：**',
    sentence: '**原文：**',
  };

  function insertEntry(content, urlHeading, sectionLabel, entryText) {
    const urlIdx = content.indexOf(urlHeading);

    if (urlIdx === -1) {
      return content.trimEnd() + `\n\n${urlHeading}\n\n${sectionLabel}\n1. ${entryText}\n`;
    }

    const afterUrl = urlIdx + urlHeading.length;
    const nextUrl = content.indexOf('\n### ', afterUrl);
    const urlEnd = nextUrl !== -1 ? nextUrl : content.length;
    const urlSection = content.substring(urlIdx, urlEnd);

    const catIdx = urlSection.indexOf(sectionLabel);

    if (catIdx === -1) {
      const insertPos = urlEnd;
      return content.substring(0, insertPos).trimEnd() + `\n\n${sectionLabel}\n1. ${entryText}\n` + content.substring(insertPos);
    }

    const absCatStart = urlIdx + catIdx + sectionLabel.length;
    const remainingInUrl = urlSection.substring(catIdx + sectionLabel.length);
    const nextCat = remainingInUrl.search(/\n\*\*[^*]+：\*\*/);
    const catEnd = nextCat !== -1 ? absCatStart + nextCat : urlEnd;

    const catContent = content.substring(absCatStart, catEnd);
    const entries = catContent.match(/^\d+\./gm) || [];
    const nextNum = entries.length + 1;

    return content.substring(0, catEnd).trimEnd() + `\n${nextNum}. ${entryText}\n` + content.substring(catEnd);
  }

  function saveToObsidian(original, translated, posInfo) {
    const { fileName } = getTodayFileName();
    const pageUrl = window.location.href;
    const urlHeading = `### ${pageUrl}`;

    const type = getEntryType(original, posInfo);
    const sectionLabel = SECTION_LABELS[type];

    let entryText;
    if (type === 'word') {
      entryText = `**${original}** — ${posInfo}`;
    } else if (type === 'phrase') {
      entryText = `**${original}** — ${translated}`;
    } else {
      entryText = `${original}\n   译文：${translated}`;
    }

    const url = getVaultUrl(fileName);

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: { 'Authorization': `Bearer ${CONFIG.OBSIDIAN_API_KEY}` },
        onload: (getRes) => {
          let fullContent;
          if (getRes.status === 200) {
            fullContent = insertEntry(getRes.responseText, urlHeading, sectionLabel, entryText);
          } else {
            fullContent = `${urlHeading}\n\n${sectionLabel}\n1. ${entryText}\n`;
          }
          GM_xmlhttpRequest({
            method: 'PUT',
            url: url,
            headers: {
              'Authorization': `Bearer ${CONFIG.OBSIDIAN_API_KEY}`,
              'Content-Type': 'text/markdown',
            },
            data: fullContent,
            onload: (putRes) => {
              if (putRes.status >= 200 && putRes.status < 300) resolve();
              else reject(`保存失败 (${putRes.status})`);
            },
            onerror: () => reject('无法连接 Obsidian'),
          });
        },
        onerror: () => reject('无法连接 Obsidian，请确认 Local REST API 已启动'),
      });
    });
  }

  // ============ 朗读 (Google Translate TTS) ============
  let currentAudio = null;

  function speakText(text, lang, btn) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    btn.classList.add('speaking');

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;

    GM_xmlhttpRequest({
      method: 'GET',
      url: ttsUrl,
      responseType: 'blob',
      onload: (res) => {
        const blobUrl = URL.createObjectURL(res.response);
        const audio = new Audio(blobUrl);
        currentAudio = audio;
        audio.onended = () => {
          btn.classList.remove('speaking');
          URL.revokeObjectURL(blobUrl);
          currentAudio = null;
        };
        audio.onerror = () => {
          btn.classList.remove('speaking');
          URL.revokeObjectURL(blobUrl);
          currentAudio = null;
        };
        audio.play();
      },
      onerror: () => {
        btn.classList.remove('speaking');
      },
    });
  }

  // ============ 主逻辑 ============
  const popup = createPopup();
  const elOriginal = popup.querySelector('#trans-obsidian-original');
  const elResult = popup.querySelector('#trans-obsidian-result');
  const elSave = popup.querySelector('#trans-obsidian-save');
  const elStatus = popup.querySelector('#trans-obsidian-status');
  const elClose = popup.querySelector('#trans-obsidian-close');

  let currentOriginal = '';
  let currentTranslated = '';
  let currentPosInfo = '';
  let currentLang = 'en';

  function showPopup(x, y) {
    const maxX = window.innerWidth - 360;
    const maxY = window.innerHeight - 320;
    popup.style.left = Math.min(x + 10, maxX) + 'px';
    popup.style.top = Math.min(y + 10, maxY) + 'px';
    popup.style.display = 'block';
  }

  function hidePopup() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    popup.style.display = 'none';
    elStatus.textContent = '';
    elSave.disabled = false;
  }

  const elSpeakOrig = popup.querySelector('#trans-obsidian-speak-orig');

  elClose.addEventListener('click', hidePopup);

  elSpeakOrig.addEventListener('click', () => {
    if (currentOriginal) speakText(currentOriginal, currentLang, elSpeakOrig);
  });

  let isMouseDown = false;
  let pendingSelection = false;

  document.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    if (!popup.contains(e.target)) hidePopup();
  }, true);

  document.addEventListener('mouseup', () => {
    isMouseDown = false;
    if (pendingSelection) {
      pendingSelection = false;
      handleSelection();
    }
  }, true);

  let selectionTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (isMouseDown) {
        pendingSelection = true;
      } else {
        handleSelection();
      }
    }, 100);
  });

  async function handleSelection() {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (!text || text.length < CONFIG.MIN_LENGTH || text.length > CONFIG.MAX_LENGTH) return;
    if (sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    currentOriginal = text;
    currentTranslated = '';
    currentPosInfo = '';
    elOriginal.textContent = text;
    elResult.textContent = '翻译中...';
    elSave.disabled = true;
    elStatus.textContent = '';
    showPopup(rect.right, rect.bottom);

    try {
      const result = await translate(text);
      currentTranslated = result.translated;
      currentPosInfo = result.posInfo;
      currentLang = result.detectedLang;
      if (currentPosInfo) {
        elResult.innerHTML = `${currentTranslated}<br><span style="color:#888;font-size:12px">${currentPosInfo}</span>`;
      } else {
        elResult.textContent = currentTranslated;
      }
      elSave.disabled = false;
    } catch (err) {
      elResult.textContent = '翻译失败: ' + err;
    }
  }

  elSave.addEventListener('click', async () => {
    if (!currentOriginal || !currentTranslated) return;
    elSave.disabled = true;
    elStatus.textContent = '保存中...';
    try {
      await saveToObsidian(currentOriginal, currentTranslated, currentPosInfo);
      elStatus.textContent = '已保存 ✓';
      elStatus.style.color = '#4caf50';
    } catch (err) {
      elStatus.textContent = err;
      elStatus.style.color = '#f44336';
      elSave.disabled = false;
    }
  });
})();
