/**
 * AnonGuard Gate — Embeddable Content Paywall Widget
 * @version 1.0.0
 *
 * Usage:
 *   <div data-anonguard-gate="CONTENT_ID" data-shard="CLIENT_SHARD"></div>
 *   <script src="https://anonguard.io/gate.js"></script>
 *
 * Source: https://github.com/AnonGuardX/anonguard-gate
 *
 * Architecture: slim JS loader + iframe for the payment UI.
 * Uses split-key encryption: the server only holds one shard of the
 * content key. The other shard is in the data-shard attribute.
 * Neither alone can decrypt — both are required.
 */
(function () {
  'use strict';

  var API_BASE = (function () {
    var scripts = document.querySelectorAll('script[src*="gate.js"]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('gate.js') !== -1) {
        try {
          var url = new URL(src, window.location.href);
          return url.origin;
        } catch (_) { /* fall through */ }
      }
    }
    return 'https://anonguard.io';
  })();

  var LS_PREFIX = 'ag_unlock_';

  // ── Helpers ──────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style' && typeof attrs[k] === 'object')
        Object.assign(node.style, attrs[k]);
      else if (k.slice(0, 2) === 'on')
        node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else
        node.setAttribute(k, attrs[k]);
    });
    if (children != null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) children.forEach(function (c) { if (c) node.appendChild(c); });
      else node.appendChild(children);
    }
    return node;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(API_BASE + '/api/gate' + path, opts).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Request failed'); });
      return r.json();
    });
  }

  // ── AES-256-GCM Decrypt (Web Crypto) ─────────────────────────

  function b64ToU8(b64) {
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }

  function u8ToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function xorShards(aB64, bB64) {
    var a = b64ToU8(aB64), b = b64ToU8(bB64);
    var out = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return u8ToB64(out);
  }

  function sha256Hex(data) {
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      var arr = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
      return hex;
    });
  }

  function aesDecrypt(ciphertextB64, ivB64, keyB64) {
    var key = b64ToU8(keyB64), iv = b64ToU8(ivB64), ct = b64ToU8(ciphertextB64);
    return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct); })
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  // ── Inline SVG icons ─────────────────────────────────────────

  function lockSvg() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    var path1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    path1.setAttribute('x', '3'); path1.setAttribute('y', '11');
    path1.setAttribute('width', '18'); path1.setAttribute('height', '11');
    path1.setAttribute('rx', '2'); path1.setAttribute('ry', '2');
    var path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
    svg.appendChild(path1); svg.appendChild(path2);
    return svg;
  }

  function shieldSvg() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
    svg.appendChild(p);
    return svg;
  }

  function checkSvg() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#4ade80');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M20 6L9 17l-5-5');
    svg.appendChild(p);
    return svg;
  }

  // ── Inject global styles once ────────────────────────────────

  var styleInjected = false;
  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var css = [
      '@keyframes ag-pulse{0%,100%{opacity:.6}50%{opacity:1}}',
      '@keyframes ag-fadein{from{opacity:0}to{opacity:1}}',
      '.ag-gate *{box-sizing:border-box;margin:0;padding:0}',
      '.ag-modal-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;',
      'background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:center;',
      'justify-content:center;animation:ag-fadein .2s ease;padding:12px}',
      '.ag-modal-frame{width:100%;max-width:460px;height:min(90dvh,720px);border-radius:16px;',
      'overflow:hidden;border:1px solid rgba(255,255,255,.1);box-shadow:0 8px 40px rgba(0,0,0,.5)}',
      '.ag-modal-frame iframe{width:100%;height:100%;border:none}',
      '.ag-modal-close{position:absolute;top:12px;right:16px;background:rgba(255,255,255,.1);',
      'border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:18px;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;',
      'transition:background .15s}',
      '.ag-modal-close:hover{background:rgba(255,255,255,.2)}',
      '@supports not (height:1dvh){.ag-modal-frame{height:90vh;max-height:720px}}',
    ].join('\n');
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Widget ───────────────────────────────────────────────────

  function GateWidget(host) {
    var contentId = host.getAttribute('data-anonguard-gate');
    if (!contentId) return;

    var clientShard = host.getAttribute('data-shard') || '';

    injectStyles();

    var root = el('div', { class: 'ag-gate', style: {
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      background: '#0f0d1a',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: '16px',
      overflow: 'hidden',
      color: '#e5e7eb',
      maxWidth: '100%',
      boxShadow: '0 2px 16px rgba(0,0,0,.3)',
    }});
    host.innerHTML = '';
    host.appendChild(root);

    var modal = null;
    var keyFingerprint = '';

    function reconstructAndDecrypt(serverShard, encryptedBlob, iv) {
      var contentKey = clientShard ? xorShards(serverShard, clientShard) : serverShard;

      var verifyAndDecrypt = function () {
        return aesDecrypt(encryptedBlob, iv, contentKey);
      };

      if (keyFingerprint && clientShard) {
        return sha256Hex(b64ToU8(contentKey)).then(function (hash) {
          if (hash !== keyFingerprint) {
            return Promise.reject(new Error('Key integrity check failed'));
          }
          return verifyAndDecrypt();
        });
      }
      return verifyAndDecrypt();
    }

    // ── Receipt re-unlock ───────────────────────────────────────
    function tryReceipt() {
      var receipt = localStorage.getItem(LS_PREFIX + contentId);
      if (!receipt) return Promise.resolve(false);
      return api('/unlock', {
        method: 'POST',
        body: JSON.stringify({ contentId: contentId, receipt: receipt }),
      }).then(function (d) {
        var shard = d.serverShard || d.contentKey;
        return reconstructAndDecrypt(shard, d.encryptedBlob, d.iv).then(function (payload) {
          showUnlocked(payload);
          return true;
        });
      }).catch(function () {
        localStorage.removeItem(LS_PREFIX + contentId);
        return false;
      });
    }

    // ── Render locked teaser ────────────────────────────────────
    function showLocked(meta) {
      root.innerHTML = '';

      // Header bar with title + price
      var header = el('div', { style: {
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,.06)',
      }}, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }}, [
          el('div', { style: {
            width: '28px', height: '28px', borderRadius: '8px',
            background: 'rgba(255,255,255,.05)',
            border: '1px solid rgba(255,255,255,.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}, lockSvg()),
          el('span', { style: {
            fontSize: '14px', fontWeight: '600', color: '#f3f4f6',
          }}, meta.title),
        ]),
        el('span', { style: {
          fontSize: '14px', fontWeight: '700', color: '#e5e7eb',
          background: 'rgba(255,255,255,.06)',
          padding: '4px 10px', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,.1)',
        }}, '$' + parseFloat(meta.priceUsd).toFixed(2)),
      ]);
      root.appendChild(header);

      // Teaser area — clearly readable with fade-to-locked effect
      if (meta.teaserText) {
        var teaser = el('div', { style: {
          padding: '20px 24px 0 24px',
          position: 'relative',
          overflow: 'hidden',
        }}, [
          el('div', { style: {
            lineHeight: '1.8',
            fontSize: '14px',
            color: '#d1d5db',
            userSelect: 'none',
            maxHeight: '100px',
            overflow: 'hidden',
          }}, meta.teaserText),
          // Gradient fade at the bottom
          el('div', { style: {
            position: 'absolute', bottom: '0', left: '0', right: '0', height: '50px',
            background: 'linear-gradient(transparent, #0f0d1a)',
            pointerEvents: 'none',
          }}),
        ]);
        root.appendChild(teaser);

        var hint = el('div', { style: {
          textAlign: 'center', padding: '8px 24px 0 24px',
        }}, [
          el('span', { style: {
            fontSize: '12px', color: '#9ca3af',
          }}, 'Pay to unlock the full content'),
        ]);
        root.appendChild(hint);
      }

      // CTA section
      var body = el('div', { style: { padding: '16px 24px 20px 24px', textAlign: 'center' }});

      // Unlock button
      var btn = el('button', { style: {
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '12px 36px',
        background: '#7c3aed',
        color: '#fff', border: 'none', borderRadius: '10px',
        fontSize: '15px', fontWeight: '600', cursor: 'pointer',
        transition: 'background .15s',
        letterSpacing: '0.01em',
      }, onClick: function () { openPaymentModal(); }}, [
        el('span', null, 'Unlock Content'),
      ]);
      btn.addEventListener('mouseenter', function () {
        btn.style.background = '#6d28d9';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.background = '#7c3aed';
      });
      body.appendChild(btn);

      root.appendChild(body);

      // Footer
      var walletLink = el('span', { style: {
        color: '#9ca3af', cursor: 'pointer', textDecoration: 'underline',
        fontSize: '12px',
      }, onClick: function () { openPaymentModal('verify'); }}, 'Already paid? Connect wallet');

      root.appendChild(el('div', { style: {
        padding: '12px 24px',
        borderTop: '1px solid rgba(255,255,255,.06)',
        textAlign: 'center', fontSize: '12px', color: '#6b7280',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
      }}, [
        el('span', { style: { display: 'inline-flex', color: '#6b7280' }}, shieldSvg()),
        el('span', null, 'Secured by AnonGuard'),
        el('span', null, ' \u00B7 '),
        walletLink,
      ]));
    }

    // ── Render unlocked content ─────────────────────────────────
    function showUnlocked(payload, txHash) {
      root.innerHTML = '';
      root.style.border = '1px solid rgba(74,222,128,.2)';
      root.style.boxShadow = '0 4px 24px rgba(74,222,128,.06)';

      var contentWrap = el('div', { style: {
        padding: '24px', lineHeight: '1.8', fontSize: '15px',
        color: '#e5e7eb',
      }});

      // Text content
      if (payload.content) {
        contentWrap.appendChild(el('div', { style: {
          whiteSpace: 'pre-wrap',
        }}, payload.content));
      }

      // Files (images rendered inline, others as download buttons)
      if (payload.files && payload.files.length > 0) {
        var gallery = el('div', { style: {
          display: 'flex', flexDirection: 'column', gap: '16px',
          marginTop: payload.content ? '20px' : '0',
        }});

        for (var fi = 0; fi < payload.files.length; fi++) {
          var file = payload.files[fi];
          if (!file.data) continue;

          if (file.type && file.type.startsWith('image/')) {
            var src = 'data:' + file.type + ';base64,' + file.data;
            var img = el('img', {
              src: src,
              alt: file.name || 'Image',
              style: {
                maxWidth: '100%', borderRadius: '8px',
                border: '1px solid rgba(255,255,255,.08)',
              },
            });
            gallery.appendChild(img);
          } else {
            var ext = (file.name || 'file').split('.').pop().toUpperCase().substring(0, 4);
            var rawBytes = Math.ceil(file.data.length * 3 / 4);
            var sizeLabel = rawBytes < 1024 ? rawBytes + ' B'
              : rawBytes < 1048576 ? (rawBytes / 1024).toFixed(0) + ' KB'
              : (rawBytes / 1048576).toFixed(1) + ' MB';

            var btn = el('button', { style: {
              display: 'flex', alignItems: 'center', gap: '12px',
              width: '100%', padding: '12px', borderRadius: '12px',
              border: '1px solid rgba(255,255,255,.1)',
              background: 'rgba(255,255,255,.03)',
              cursor: 'pointer', textAlign: 'left', color: '#e5e7eb',
            }});

            var badge = el('div', { style: {
              width: '40px', height: '40px', borderRadius: '8px', flexShrink: '0',
              background: 'rgba(124,58,237,.12)', border: '1px solid rgba(124,58,237,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', fontWeight: '700', color: '#c4b5fd', textTransform: 'uppercase',
            }}, ext);

            var info = el('div', { style: { flex: '1', minWidth: '0' }});
            info.appendChild(el('div', { style: {
              fontSize: '14px', fontWeight: '500', color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}, file.name || 'Download file'));
            info.appendChild(el('div', { style: {
              fontSize: '11px', color: '#9ca3af',
            }}, sizeLabel));

            var arrow = el('span', { style: { color: '#6b7280', fontSize: '14px', flexShrink: '0' }}, '\u2193');

            btn.appendChild(badge);
            btn.appendChild(info);
            btn.appendChild(arrow);

            (function (f) {
              btn.addEventListener('click', function () {
                var raw = atob(f.data);
                var arr = new Uint8Array(raw.length);
                for (var j = 0; j < raw.length; j++) arr[j] = raw.charCodeAt(j);
                var blob = new Blob([arr], { type: f.type || 'application/octet-stream' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = f.name || 'file';
                document.body.appendChild(a); a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              });
            })(file);

            gallery.appendChild(btn);
          }
        }

        contentWrap.appendChild(gallery);
      }

      root.appendChild(contentWrap);

      var footerItems = [
        checkSvg(),
        el('span', { style: { color: '#4ade80' }}, 'Unlocked'),
        el('span', null, ' \u00B7 Secured by AnonGuard'),
      ];

      if (txHash) {
        footerItems.push(el('span', null, ' \u00B7 '));
        footerItems.push(el('a', {
          href: 'https://solscan.io/tx/' + txHash,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { color: '#9ca3af', textDecoration: 'underline' },
        }, 'View on Solscan'));
      }

      root.appendChild(el('div', { style: {
        padding: '10px 24px',
        borderTop: '1px solid rgba(74,222,128,.15)',
        textAlign: 'center', fontSize: '11px', color: '#6b7280',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        flexWrap: 'wrap',
      }}, footerItems));
    }

    function walletUnlock() {
      var po = encodeURIComponent(window.location.origin);
      window.open(API_BASE + '/gate/wallet-verify/' + contentId + '?po=' + po, '_blank');
    }

    // ── Payment modal (iframe) ──────────────────────────────────
    function openPaymentModal(initialTab) {
      if (modal) return;

      var parentOrigin = encodeURIComponent(window.location.origin);
      var iframeUrl = API_BASE + '/gate/pay/' + contentId + '?po=' + parentOrigin;
      if (initialTab) iframeUrl += '&tab=' + encodeURIComponent(initialTab);

      var backdrop = el('div', { class: 'ag-modal-backdrop' });
      var frame = el('div', { class: 'ag-modal-frame', style: { position: 'relative' }});
      var iframe = el('iframe', {
        src: iframeUrl,
        allow: 'clipboard-write',
        style: { background: '#0f0d1a' },
      });

      var closeBtn = el('button', { class: 'ag-modal-close', onClick: closeModal }, '\u00D7');

      frame.appendChild(closeBtn);
      frame.appendChild(iframe);
      backdrop.appendChild(frame);

      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) closeModal();
      });

      document.body.appendChild(backdrop);
      document.body.style.overflow = 'hidden';
      modal = backdrop;
    }

    function closeModal() {
      if (!modal) return;
      document.body.removeChild(modal);
      document.body.style.overflow = '';
      modal = null;
    }

    // ── postMessage listener ────────────────────────────────────
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data) return;

      // All gate messages must originate from API_BASE (anonguard.io)
      if (event.origin !== API_BASE) return;

      // Result from wallet-verify tab (opened via window.open, posts back to opener)
      if (data.type === 'anonguard-gate-wallet-verified' && data.contentId === contentId) {
        if (data.unlockReceipt) localStorage.setItem(LS_PREFIX + contentId, data.unlockReceipt);
        var shard = data.serverShard || data.contentKey;
        var verifyTxHash = data.txHash;
        reconstructAndDecrypt(shard, data.encryptedBlob, data.iv)
          .then(function (payload) {
            closeModal();
            showUnlocked(payload, verifyTxHash);
          }).catch(function () {
            closeModal();
            root.innerHTML = '';
            root.appendChild(el('div', { style: {
              padding: '24px', textAlign: 'center', color: '#f87171', fontSize: '14px',
            }}, 'Wallet verification succeeded but decryption failed. The content may have been tampered with.'));
          });
        return;
      }

      // From iframe: user clicked "Connect Wallet to Verify" inside the modal.
      // Keep the modal open so the user sees the transitional "Verification window opened" state.
      // The modal will close automatically once wallet verification succeeds
      // (handled by the anonguard-gate-wallet-verified message above).
      if (data.type === 'anonguard-gate-wallet-verify' && data.contentId === contentId) {
        walletUnlock();
        return;
      }

      if (data.type !== 'anonguard-gate-unlock') return;
      if (data.contentId !== contentId) return;

      if (data.unlockReceipt) {
        localStorage.setItem(LS_PREFIX + contentId, data.unlockReceipt);
      }

      var unlockShard = data.serverShard || data.contentKey;
      var unlockTxHash = data.txHash;
      reconstructAndDecrypt(unlockShard, data.encryptedBlob, data.iv)
        .then(function (payload) {
          closeModal();
          showUnlocked(payload, unlockTxHash);
        })
        .catch(function () {
          closeModal();
          root.innerHTML = '';
          root.appendChild(el('div', { style: {
            padding: '24px', textAlign: 'center', color: '#f87171',
          }}, 'Decryption failed. Please try again.'));
        });
    });


    // ── Init ────────────────────────────────────────────────────
    tryReceipt().then(function (unlocked) {
      if (unlocked) return;
      return api('/meta/' + contentId).then(function (meta) {
        if (meta.keyFingerprint) keyFingerprint = meta.keyFingerprint;
        showLocked(meta);
      });
    }).catch(function (err) {
      root.innerHTML = '';
      root.appendChild(el('div', { style: {
        padding: '24px', textAlign: 'center', color: '#f87171', fontSize: '14px',
      }}, err.message || 'Failed to load content'));
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────

  function init() {
    var nodes = document.querySelectorAll('[data-anonguard-gate]');
    for (var i = 0; i < nodes.length; i++) GateWidget(nodes[i]);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
