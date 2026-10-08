"use strict";

const $ = (id) => document.getElementById(id);
const state = { user: null, info: null, mode: "login", previewUrl: null, requestId: 0 };
const UNSURE_BELOW = 0.5;  // top answer under 50%: say the model is unsure

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

async function api(path, { body, json } = {}) {
  const opts = { method: body === undefined && json === undefined ? "GET" : "POST", headers: {}, credentials: "same-origin" };
  if (opts.method === "POST") opts.headers["X-Requested-With"] = "fetch";
  if (json !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(json); }
  if (body !== undefined) opts.body = body;
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data.error || "Something went wrong. Please try again."); e.status = res.status; throw e; }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

const pct = (p) => (p * 100).toFixed(p >= 0.995 || p < 0.001 ? 0 : 1) + "%";
const whole = (p) => (p > 0 && p < 0.1 ? (p * 100).toFixed(1) : Math.round(p * 100)) + "%";  // small rates keep a decimal
const className = (code) => state.info?.classes[code]?.name ?? code;

// ---------- tabs ----------
const TABS = ["check", "accuracy", "privacy"];
function showTab(name) {
  for (const a of document.querySelectorAll("nav.tabs a")) a.classList.toggle("active", a.dataset.tab === name);
  for (const id of TABS) $(id).hidden = id !== name;
}
for (const a of document.querySelectorAll("nav.tabs a")) {
  a.addEventListener("click", (e) => { e.preventDefault(); showTab(a.dataset.tab); history.replaceState(null, "", "#" + a.dataset.tab); });
}
if (TABS.includes(location.hash.slice(1))) showTab(location.hash.slice(1));

// ---------- account ----------
function setUser(user) {
  state.user = user;
  $("auth").hidden = !!user;
  $("app").hidden = !user;
  $("who").hidden = !user;
  $("signout").hidden = !user;
  $("signin-top").hidden = !!user;
  $("delete-section").hidden = !user;
  if (user) {
    $("username").textContent = user;
    $("avatar").textContent = user[0];
  }
  clearPhoto();
}

function setMode(mode) {
  state.mode = mode;
  const signup = mode === "signup";
  $("seg-login").setAttribute("aria-selected", String(!signup));
  $("seg-signup").setAttribute("aria-selected", String(signup));
  $("confirm-field").hidden = !signup;
  $("user-hint").hidden = !signup;
  $("pass-hint").hidden = !signup;
  $("f-pass").autocomplete = signup ? "new-password" : "current-password";
  $("auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("auth-error").hidden = true;
}
$("seg-login").onclick = () => setMode("login");
$("seg-signup").onclick = () => setMode("signup");
$("signin-top").onclick = () => { showTab("check"); setMode("login"); $("f-user").focus(); };

$("toggle-pw").onclick = () => {
  const show = $("f-pass").type === "password";
  for (const id of ["f-pass", "f-pass2"]) $(id).type = show ? "text" : "password";
  $("toggle-pw").textContent = show ? "Hide" : "Show";
  $("toggle-pw").setAttribute("aria-label", show ? "Hide password" : "Show password");
};

function authError(msg) { $("auth-error").textContent = msg; $("auth-error").hidden = false; }

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("f-user").value.trim(), password = $("f-pass").value;
  if (state.mode === "signup") {
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return authError("Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore.");
    if (password.length < 8) return authError("Password must be at least 8 characters.");
    if (password !== $("f-pass2").value) return authError("The two passwords don't match.");
  } else if (!username || !password) {
    return authError("Enter your username and password.");
  }
  const btn = $("auth-submit");
  btn.disabled = true;
  try {
    const data = await api(state.mode === "signup" ? "/api/signup" : "/api/login", { json: { username, password } });
    $("auth-form").reset();
    setUser(data.user);
    toast(state.mode === "signup" ? `Account created. Welcome, ${data.user}.` : `Signed in as ${data.user}.`);
  } catch (err) {
    authError(err.message);
  } finally {
    btn.disabled = false;
  }
});

$("signout").onclick = async () => {
  try { await api("/api/logout", { json: {} }); } catch { /* signing out locally anyway */ }
  setUser(null); setMode("login"); showTab("check");
  toast("Signed out.");
};

$("delete-open").onclick = () => { $("delete-error").hidden = true; $("delete-form").reset(); $("delete-dialog").showModal(); };
$("delete-cancel").onclick = () => $("delete-dialog").close();
$("delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("delete-confirm").disabled = true;
  try {
    await api("/api/delete-account", { json: { password: $("d-pass").value } });
    $("delete-dialog").close();
    setUser(null); setMode("signup"); showTab("check");
    toast("Your account has been deleted.");
  } catch (err) {
    $("delete-error").textContent = err.message; $("delete-error").hidden = false;
  } finally {
    $("delete-confirm").disabled = false;
  }
});

// ---------- photo upload ----------
const zone = $("zone"), fileInput = $("file");
$("choose").onclick = () => fileInput.click();
zone.onclick = () => fileInput.click();
zone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { if (fileInput.files[0]) check(fileInput.files[0], null); fileInput.value = ""; };
zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
zone.ondragleave = () => zone.classList.remove("over");
zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer.files[0]) check(e.dataTransfer.files[0], null); };
document.addEventListener("paste", (e) => {
  if (!state.user || $("app").hidden) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) check(item.getAsFile(), null);
});
$("clear").onclick = () => { clearPhoto(); toast("Photo removed."); };

function waiting(text) {
  const v = $("verdict");
  v.className = "panel verdict waiting";
  v.replaceChildren(el("div", { class: "label", text: "Result" }), el("div", { class: "big", text }));
  $("care").hidden = true;
  $("seen").hidden = true;
  $("probs").hidden = true;
}

function clearPhoto() {
  state.requestId++;  // ignore any result still on its way
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  $("preview").removeAttribute("src"); $("preview").hidden = true;
  $("hint").hidden = false; $("busy").hidden = true; $("clear").hidden = true;
  $("truth").textContent = ""; $("error").hidden = true;
  waiting("Add a photo to see the result here.");
}

async function check(blob, truth) {
  if (!blob.type.startsWith("image/")) { showError("Please choose an image file (JPG or PNG)."); return; }
  if (blob.size > 20 * 1024 * 1024) { showError("That image is over 20 MB. Please choose a smaller one."); return; }
  const id = ++state.requestId;
  $("error").hidden = true;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(blob);
  $("preview").src = state.previewUrl; $("preview").hidden = false; $("hint").hidden = true;
  $("busy").hidden = false; $("clear").hidden = false;
  waiting("Checking the photo");
  $("truth").textContent = "";
  if (truth) $("truth").append("True diagnosis: ", el("b", { text: className(truth) }));
  try {
    const data = await api("/api/predict", { body: blob });
    if (id !== state.requestId) return;
    render(data.results, truth);
  } catch (err) {
    if (id !== state.requestId) return;
    if (err.status === 401) { setUser(null); toast("Your session ended. Please sign in again."); return; }
    waiting("Add a photo to see the result here.");
    showError(err.message);
  } finally {
    if (id === state.requestId) $("busy").hidden = true;
  }
}

function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }

function sureWords(p) {
  const how = p >= 0.7 ? "fairly sure" : p >= UNSURE_BELOW ? "somewhat sure" : "not sure";
  return `The model is ${how} about this (${whole(p)} likely).`;
}

// The whole answer, in plain language: what it might be, what the model looked at, how it is
// dealt with, and when to see a doctor. The melanoma warning and an unsure model both raise the
// advice to "see a doctor", because missing a cancer is the costly mistake.
function renderRejected() {
  const v = $("verdict");
  v.className = "panel verdict";
  v.replaceChildren(
    el("div", { class: "label", text: "Result" }),
    el("div", { class: "big", text: "This doesn't look like a close-up skin photo" }),
    el("p", { class: "about", text: "The model learned from close-up photos of skin spots taken through a skin magnifier (a dermatoscope). " +
      "This photo is too different from those, so any answer would be a guess, and the site won't guess about your health." }),
    el("ul", { class: "tips" },
      el("li", { text: "Take the photo close up, with the spot in the centre and filling most of the frame." }),
      el("li", { text: "Use good, even light, and keep the camera steady and in focus." }),
      el("li", { text: "If a spot worries you, a doctor can check it properly with a dermatoscope." })));
  for (const id of ["seen", "care", "probs"]) $(id).hidden = true;
}

function render(r, truth) {
  if (r.rejected) return renderRejected();
  const m = state.info, info = m.classes[r.top], care = info.care, top = r.probs[0], second = r.probs[1];
  let level = care.level, headline = care.headline, why = "", steps = care.steps, treatment = care.treatment;
  if (r.melanoma_warning && r.top !== "mel") {
    const pMel = r.probs.find((p) => p.code === "mel").p;
    level = "urgent"; headline = "Please see a doctor soon: melanoma can't be ruled out";
    why = `Although ${info.name.toLowerCase()} is the most likely answer, the model gives melanoma a ${pct(pMel)} chance. ` +
      `This site asks you to see a doctor whenever that chance is ${pct(m.melanoma_threshold)} or more, which in testing caught ${whole(m.test.melanoma_recall_with_warning)} of melanomas.`;
    steps = m.classes.mel.care.steps;
  } else if (level === "selfcare" && top.p < UNSURE_BELOW) {
    level = "doctor"; headline = "Have a doctor take a look";
    why = "The model is not confident about this photo, so a doctor's opinion is the safe next step.";
  }
  const tag = level === "selfcare" ? ["ok", "Usually harmless"] : info.serious ? ["warn", "Can be serious"] : ["warn", "Get it checked"];

  // 1. What it might be
  let sure = sureWords(top.p);
  if (top.p < 0.7) sure += ` It could also be ${className(second.code).toLowerCase()} (${whole(second.p)}).`;
  const v = $("verdict");
  v.className = "panel verdict";
  v.replaceChildren(...[
    el("div", { class: "label", text: r.top === "healthy" ? "Result" : "This might be" }),
    el("div", { class: "big" }, info.name, el("span", { class: "tag " + tag[0], text: r.top === "healthy" && level === "selfcare" ? "No lesion found" : tag[1] })),
    el("p", { class: "about", text: info.about }),
    el("p", { class: "sub", text: sure }),
    truth && el("p", { class: "sub", text: truth === r.top ? "This matches the true diagnosis of the sample." : `The true diagnosis of this sample is ${className(truth)}.` }),
  ].filter(Boolean));

  // 2. What the model looked at
  const img = el("img", { src: r.attention, alt: "The photo with the areas the model ignored dimmed" });
  $("seen").replaceChildren(
    el("figure", { class: "seen-img" }, img, el("figcaption", { text: "Bright = where the model looked. Dimmed = what it ignored." })),
    el("div", {},
      el("h3", { text: "What the model is looking at" }),
      el("p", { text: r.top === "healthy"
        ? "The bright areas are the parts of the photo that most influenced the answer."
        : "The bright area is the part of the photo that most influenced the answer. If it is not on the spot itself, the result is less trustworthy." }),
      el("h3", { text: `What ${info.name.toLowerCase()} usually looks like` }),
      el("p", { text: `Typically ${info.care.looks}. These are general signs; only a doctor can confirm what this is.` })));
  $("seen").hidden = false;

  // 3. What to do
  $("care").replaceChildren(...[
    el("div", { class: "care " + level }, ...[
      el("h3", { text: headline }),
      why && el("p", { class: "why", text: why }),
      el("h4", { text: "How it is usually treated" }),
      el("p", { class: "why", text: level === "urgent" && r.top !== "mel" ? "If it turns out to be a melanoma: " + m.classes.mel.care.treatment : treatment }),
      el("h4", { text: "What you can do now" }),
      el("ol", {}, ...steps.map((s) => el("li", { text: s }))),
    ].filter(Boolean)),
    el("div", { class: "signs" }, el("h3", { text: "See a doctor straight away if" }),
      el("ul", {}, ...m.urgent_signs.map((s) => el("li", { text: s })))),
  ]);
  $("care").hidden = false;

  // 4. All possibilities, folded away
  const bars = r.probs.map((p) => {
    const fill = el("span", { class: "fill" + (p.code === r.top ? " lead" : "") });
    fill.style.width = (p.p * 100).toFixed(1) + "%";
    return el("div", { class: "bar" },
      el("span", { class: "lab", title: className(p.code), text: className(p.code) }),
      el("span", {}, fill),
      el("span", { class: "val", text: pct(p.p) }));
  });
  $("probs").replaceChildren(el("details", {},
    el("summary", {}, "All 7 possibilities", el("span", { class: "ms", text: ` checked in ${r.ms} ms` })),
    el("div", { class: "bars" }, ...bars)));
  $("probs").hidden = false;
}

// ---------- accuracy tab ----------
function renderAccuracy(m) {
  const stat = (big, small) => el("div", { class: "stat" }, el("b", { text: big }), el("span", { text: small }));
  const pc = m.photo_check;
  $("acc-stats").replaceChildren(
    stat(m.test.macro_f1.toFixed(3), "macro F1 on held-out HAM10000 photos and healthy-skin patches (1.0 is perfect)"),
    stat(m.external.macro_f1.toFixed(3), "macro F1 on 1,511 lesion photos from a different collection"),
    stat(whole(m.test.per_class_recall.healthy), "of healthy-skin test patches correctly called healthy"),
    stat(whole(m.test.lesions_called_healthy), "of test lesions wrongly called healthy skin"));
  $("warn-stats").replaceChildren(
    stat(whole(m.test.melanoma_recall_top_answer), "of melanomas named as the top answer"),
    stat(whole(m.test.melanoma_recall_with_warning), "of melanomas caught with the warning"),
    stat(whole(m.test.warning_on_non_melanoma), "of other photos get a warning too (false alarms)"));
  $("warn-text").textContent = `On its own, the model's top answer catches ${whole(m.test.melanoma_recall_top_answer)} of melanomas. Missing a melanoma is far worse ` +
    `than an unnecessary check-up, so the site also warns whenever the chance of melanoma is ${pct(m.melanoma_threshold)} or more, even if the top answer is healthy skin. ` +
    `That level was picked on separate validation photos to catch at least ${whole(m.target_melanoma_recall)} of melanomas there; the numbers here come from the test set.`;
  $("check-stats").replaceChildren(
    stat(whole(pc.rejected_non_skin), `of ${pc.non_skin_images} non-skin images (landscapes, abstract art) rejected`),
    stat(whole(pc.rejected_test_lesions), "of real test lesion photos wrongly rejected"),
    stat(whole(pc.rejected_external), "of photos from the other collection rejected"));

  const head = el("tr", {}, el("th", { text: "Type" }), el("th", { text: "HAM10000 test" }), el("th", { text: "ISIC 2018 test" }));
  const rows = Object.keys(m.test.per_class_recall).map((c) => el("tr", {}, el("td", { text: className(c) }),
    el("td", { text: whole(m.test.per_class_recall[c]) }),
    el("td", { text: c in m.external.per_class_recall ? whole(m.external.per_class_recall[c]) : "not in this set" })));
  $("recall-table").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
}

// ---------- examples ----------
function renderExamples(info) {
  // ?v= changes whenever a different photo is exported, so browsers never show a stale cached sample
  const src = (code) => `examples/${code}.jpg?v=${info.examples?.[code] ?? ""}`;
  for (const code of Object.keys(info.classes)) {
    const b = el("button", { class: "ex", type: "button", title: info.classes[code].name, "aria-label": `Try a sample ${info.classes[code].name} photo` },
      el("img", { src: src(code), alt: "" }));
    b.onclick = async () => check(await (await fetch(src(code))).blob(), code);
    $("examples").append(b);
  }
}

// ---------- start ----------
(async () => {
  try {
    const [info, me] = await Promise.all([api("/api/info"), api("/api/me")]);
    state.info = info;
    renderAccuracy(info);
    renderExamples(info);
    setUser(me.user);
  } catch {
    $("auth").hidden = false;
    authError("Can't reach the app server. Make sure run.bat (or python app/server.py) is still running.");
  }
})();
