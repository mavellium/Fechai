(function () {
  "use strict";

  var API_ORIGIN = __API_ORIGIN__;
  var tenantId = __TENANT_ID__;
  var color = __WIDGET_COLOR__;
  var greeting = __WIDGET_GREETING__;
  var iconType = __WIDGET_ICON_TYPE__;
  var iconEmoji = __WIDGET_ICON_EMOJI__;
  var iconUrl = __WIDGET_ICON_URL__;
  var shape = __WIDGET_SHAPE__;
  var borderColor = __WIDGET_BORDER_COLOR__;

  var SHAPE_RADIUS = { circle: "999px", rounded: "16px", square: "6px" };

  var STORAGE_KEY = "fechai_visitor_id";
  var visitorId = null;
  try {
    visitorId = window.localStorage.getItem(STORAGE_KEY);
    if (!visitorId) {
      visitorId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      window.localStorage.setItem(STORAGE_KEY, visitorId);
    }
  } catch {
    visitorId = String(Date.now()) + Math.random().toString(16).slice(2);
  }

  document.documentElement.style.setProperty("--fechai-w-color", color);
  document.documentElement.style.setProperty("--fechai-w-radius", SHAPE_RADIUS[shape] || SHAPE_RADIUS.circle);
  document.documentElement.style.setProperty("--fechai-w-border", borderColor ? "3px solid " + borderColor : "none");

  var style = document.createElement("style");
  style.textContent =
    ".fechai-w-bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:var(--fechai-w-radius,999px);background:var(--fechai-w-color,#6d5ef8);border:var(--fechai-w-border,none);color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:24px;z-index:2147483000;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:0}" +
    ".fechai-w-bubble img{width:100%;height:100%;object-fit:cover}" +
    ".fechai-w-panel{position:fixed;right:20px;bottom:88px;width:320px;max-width:calc(100vw - 40px);height:440px;max-height:calc(100vh - 140px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif}" +
    ".fechai-w-panel.fechai-w-open{display:flex}" +
    ".fechai-w-header{background:var(--fechai-w-color,#6d5ef8);color:#fff;padding:14px 16px;font-size:14px;font-weight:600}" +
    ".fechai-w-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}" +
    ".fechai-w-msg{max-width:80%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;white-space:pre-wrap}" +
    ".fechai-w-msg.user{align-self:flex-end;background:var(--fechai-w-color,#6d5ef8);color:#fff}" +
    ".fechai-w-msg.assistant{align-self:flex-start;background:#f1f1f4;color:#1a1a1a}" +
    ".fechai-w-form{display:flex;border-top:1px solid #eee;padding:8px}" +
    ".fechai-w-input{flex:1;border:none;outline:none;font-size:13px;padding:8px}" +
    ".fechai-w-send{border:none;background:none;color:var(--fechai-w-color,#6d5ef8);font-weight:600;font-size:13px;cursor:pointer;padding:0 10px}";
  document.head.appendChild(style);

  var bubble = document.createElement("button");
  bubble.className = "fechai-w-bubble";
  bubble.setAttribute("aria-label", "Abrir chat");
  if (iconType === "image" && iconUrl) {
    var img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    bubble.appendChild(img);
  } else {
    bubble.textContent = iconEmoji;
  }

  var panel = document.createElement("div");
  panel.className = "fechai-w-panel";
  panel.innerHTML =
    '<div class="fechai-w-header">Fale conosco</div>' +
    '<div class="fechai-w-messages"></div>' +
    '<form class="fechai-w-form">' +
    '<input class="fechai-w-input" type="text" placeholder="Digite sua mensagem..." autocomplete="off" />' +
    '<button class="fechai-w-send" type="submit">Enviar</button>' +
    "</form>";

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector(".fechai-w-messages");
  var formEl = panel.querySelector("form");
  var inputEl = panel.querySelector("input");

  function appendMessage(role, text) {
    var el = document.createElement("div");
    el.className = "fechai-w-msg " + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  bubble.addEventListener("click", function () {
    panel.classList.toggle("fechai-w-open");
    if (panel.classList.contains("fechai-w-open") && messagesEl.children.length === 0) {
      appendMessage("assistant", greeting);
    }
  });

  formEl.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    appendMessage("user", text);

    fetch(API_ORIGIN + "/api/widget/" + tenantId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: visitorId, message: text }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.reply) {
          appendMessage("assistant", result.data.reply);
        } else {
          appendMessage("assistant", "Não consegui responder agora. Tente de novo em instantes.");
        }
      })
      .catch(function () {
        appendMessage("assistant", "Falha de conexão. Tente de novo em instantes.");
      });
  });
})();
