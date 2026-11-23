// A compact emoji picker (system emoji font). Recent emoji sync with the app (`stickers.recentEmoji`).
import { h } from "./dom.js";
import { getS, setS } from "./settings.js";

const CATS = [
  ["😀", "Smileys", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾"],
  ["👋", "People", "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 💋 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 🧑‍💻 🧑‍🎤 🧑‍🎨 🧑‍🚀 🦸 🦹 🧙 🧜 🧚 💃 🕺 👯 🧘 🏄 🏊 🤽 🚣"],
  ["❤️", "Hearts", "❤️ 🧡 💛 💚 💙 🩵 💜 🖤 🩶 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 ✨ 🌟 ⭐ 🔥 🎉 🎊"],
  ["🐙", "Nature", "🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🦭 🐊 🐢 🦦 🐚 🪸 🪼 🌊 💧 🫧 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🌵 🌲 🌴 🌱 🌿 🍀 🍁 🍂 🌷 🌹 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌙 🌎 🪐 ⭐ ⚡ ☄️ 🌈 ☀️ ⛅ 🌧️ ⛈️ ❄️ ☃️"],
  ["🍕", "Food", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥬 🥦 🍄 🥜 🍞 🥐 🥖 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 🍯 🍼 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🍹"],
  ["⚽", "Activity", "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🥍 🏏 ⛳ 🏹 🎣 🤿 🥊 🥋 🛹 🛼 ⛸️ 🎿 🏂 🏋️ 🏆 🥇 🥈 🥉 🏅 🎖️ 🎫 🎟️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩"],
  ["🚀", "Travel", "🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚚 🚜 🛵 🏍️ 🚲 🛴 🚨 🚃 🚄 🚅 🚂 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛥️ 🛳️ ⚓ 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🏕️ 🏠 🏡 🏢 🏥 🏦 🏨 🏫 ⛪ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉"],
  ["💡", "Objects", "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 💿 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏰ ⌛ 📡 🔋 🔌 💡 🔦 🕯️ 🧯 💸 💵 💰 💳 💎 ⚖️ 🧰 🔧 🔨 🛠️ ⛏️ 🔩 ⚙️ 🧲 🔫 💣 🧨 🔪 🛡️ 🔮 📿 🧿 💈 🔭 🔬 🩹 💊 🧬 🧪 🌡️ 🧹 🧺 🧻 🚽 🛁 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🎁 🎈 🎀 🪄 ✉️ 📦 📫 📝 📁 📅 📌 📎 ✂️ 🔒 🔓"],
  ["✅", "Symbols", "✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ ‼️ ⁉️ ❓ ❔ ❕ ❗ 〰️ ⚠️ 🚫 ⛔ 📛 🔞 ♻️ 🔰 🔱 ⭕ 🛑 💲 ©️ ®️ ™️ 🔝 🔜 🔛 🔙 🔚 ▶️ ⏸️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ 🔀 🔁 🔂 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ 🔄 🎵 🎶 🔔 🔕 📣 📢 💠 🔷 🔶 🔵 🟢 🟡 🟠 🔴 🟣 ⚫ ⚪ 🟥 🟦 🟩 🟨 🏁 🚩 🏳️ 🏴 🏳️‍🌈"],
];

export function pushRecentEmoji(e) {
  const rec = (getS("stickers.recentEmoji", []) || []).filter((x) => x !== e);
  setS("stickers.recentEmoji", [e, ...rec].slice(0, 32));
}

/** Pop-up picker inside `host` (position: relative parent). Calls onPick(emoji). Returns a close function. */
export function emojiPicker(host, onPick, { onClose } = {}) {
  host.querySelector(".emoji-pop")?.remove();
  const grid = h("div", { class: "grid", role: "listbox", "aria-label": "Emoji" });
  const cats = h("div", { class: "cats", role: "tablist", "aria-label": "Emoji categories" });
  const recent = getS("stickers.recentEmoji", []) || [];
  const all = [["🕘", "Recent", recent.join(" ")], ...CATS].filter((c) => c[2].trim());
  const show = (i) => {
    [...cats.children].forEach((b, j) => { b.classList.toggle("on", i === j); b.setAttribute("aria-selected", String(i === j)); });
    grid.replaceChildren(...all[i][2].split(" ").filter(Boolean).map((e) => h("button", { type: "button", role: "option", "aria-label": e, onclick: () => { onPick(e); pushRecentEmoji(e); } }, e)));
    grid.scrollTop = 0;
  };
  all.forEach(([ic, name], i) => cats.append(h("button", { type: "button", role: "tab", title: name, "aria-label": name, onclick: () => show(i) }, ic)));
  const pop = h("div", { class: "emoji-pop", role: "dialog", "aria-label": "Emoji picker" }, cats, grid);
  const close = () => { pop.remove(); document.removeEventListener("pointerdown", outside, true); onClose?.(); };
  const outside = (e) => { if (!pop.contains(e.target) && !e.target.closest("[data-emoji-toggle]")) close(); };
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    const btns = [...grid.children], i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / (btns[0]?.offsetWidth || 38)));
    const mv = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (mv) { e.preventDefault(); btns[Math.max(0, Math.min(btns.length - 1, i + mv))].focus(); }
  });
  host.append(pop);
  show(0);
  setTimeout(() => { document.addEventListener("pointerdown", outside, true); grid.firstChild?.focus(); }, 0);
  return close;
}
