"use strict";

const $ = (id) => document.getElementById(id);
const state = { user: null, info: null, mode: "signup", previewUrl: null, requestId: 0 };
const UNSURE_BELOW = 0.5;   // top match under 50%: the AI is not confident
const MIN_ANALYSIS_MS = 1100; // keep the "looking at your image" steps on screen long enough to read
const CONSIDER = "Consider discussing this result with a qualified healthcare professional";
const SIMILAR = "Because some skin conditions can look similar, a qualified healthcare professional can look at it properly and tell you for sure.";

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null && c !== false && c !== "") node.append(c);
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => (p * 100).toFixed(p >= 0.995 || p < 0.001 ? 0 : 1) + "%";
const whole = (p) => (p > 0 && p < 0.1 ? (p * 100).toFixed(1) : Math.round(p * 100)) + "%";  // small rates keep a decimal
const className = (code) => state.info?.classes[code]?.name ?? code;
const lower = (code) => className(code).toLowerCase();

// ---------- progress stepper ----------
function setStep(n) {
  for (const li of document.querySelectorAll("#stepper li")) {
    const s = Number(li.dataset.step);
    li.classList.toggle("done", s < n);
    li.classList.toggle("current", s === n);
    if (s === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
}

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
  document.querySelector('label[for="f-user"]').textContent = signup ? "Choose a username" : "Username";
  $("f-pass").autocomplete = signup ? "new-password" : "current-password";
  $("auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("auth-error").hidden = true;
}
$("seg-login").onclick = () => setMode("login");
$("seg-signup").onclick = () => setMode("signup");
$("signin-top").onclick = () => { setMode("login"); $("check").scrollIntoView({ behavior: "smooth" }); $("f-user").focus({ preventScroll: true }); };
$("hero-cta").addEventListener("click", () => setTimeout(() => (state.user ? $("choose") : $("f-user")).focus({ preventScroll: true }), 400));

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
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return authError("Please choose a username of 3 to 32 letters or numbers (a dot, dash or underscore is fine too).");
    if (password.length < 8) return authError("Please choose a password of at least 8 characters.");
    if (password !== $("f-pass2").value) return authError("The two passwords don't match. Please type them again.");
  } else if (!username || !password) {
    return authError("Please enter your username and password.");
  }
  const btn = $("auth-submit");
  btn.disabled = true;
  try {
    const data = await api(state.mode === "signup" ? "/api/signup" : "/api/login", { json: { username, password } });
    $("auth-form").reset();
    setUser(data.user);
    toast(state.mode === "signup" ? `Welcome, ${data.user}. You're ready to check an image.` : `Welcome back, ${data.user}.`);
    $("choose").focus();
  } catch (err) {
    authError(err.message);
  } finally {
    btn.disabled = false;
  }
});

$("signout").onclick = async () => {
  try { await api("/api/logout", { json: {} }); } catch { /* signing out locally anyway */ }
  setUser(null); setMode("login");
  toast("You're signed out.");
};

$("delete-open").onclick = () => { $("delete-error").hidden = true; $("delete-form").reset(); $("delete-dialog").showModal(); };
$("delete-cancel").onclick = () => $("delete-dialog").close();
$("delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("delete-confirm").disabled = true;
  try {
    await api("/api/delete-account", { json: { password: $("d-pass").value } });
    $("delete-dialog").close();
    setUser(null); setMode("signup");
    toast("Your account has been deleted.");
  } catch (err) {
    $("delete-error").textContent = err.message; $("delete-error").hidden = false;
  } finally {
    $("delete-confirm").disabled = false;
  }
});

// ---------- upload ----------
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
$("clear").onclick = () => { clearPhoto(); toast("Image removed."); };

function clearPhoto() {
  state.requestId++;  // ignore any result still on its way
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  $("preview").removeAttribute("src"); $("preview").hidden = true;
  $("hint").hidden = false; $("clear").hidden = true;
  $("truth").textContent = ""; $("error").hidden = true;
  $("placeholder").hidden = false; $("analysing").hidden = true; $("result").hidden = true;
  setStep(1);
}

function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }

async function showProgress(id) {
  const items = [...document.querySelectorAll(".progress-list li")];
  items.forEach((li) => li.classList.remove("active", "done"));
  for (const li of items) {
    if (id !== state.requestId) return;
    li.classList.add("active");
    await sleep(MIN_ANALYSIS_MS / items.length);
    li.classList.replace("active", "done");
  }
}

async function check(blob, truth) {
  if (!blob.type.startsWith("image/")) { showError("Please choose an image file, such as a JPG or PNG photo."); return; }
  if (blob.size > 20 * 1024 * 1024) { showError("That image is larger than 20 MB. Please choose a smaller one."); return; }
  const id = ++state.requestId;
  $("error").hidden = true;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(blob);
  $("preview").src = state.previewUrl; $("preview").hidden = false; $("hint").hidden = true; $("clear").hidden = false;
  $("truth").textContent = truth ? `Example image. The confirmed answer is: ${className(truth)}.` : "";
  $("placeholder").hidden = true; $("result").hidden = true; $("analysing").hidden = false;
  setStep(2);
  try {
    const [data] = await Promise.all([api("/api/predict", { body: blob }), showProgress(id)]);
    if (id !== state.requestId) return;
    $("analysing").hidden = true;
    if (data.results.rejected) renderRejected(); else render(data.results, truth);
    setStep(data.results.rejected ? 1 : 4);
    $("result").hidden = false;
    $("result").focus({ preventScroll: true });
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (id !== state.requestId) return;
    if (err.status === 401) { setUser(null); toast("Your session ended. Please sign in again."); return; }
    $("analysing").hidden = true; $("placeholder").hidden = false; setStep(1);
    showError(err.message);
  }
}

function anotherImageButton() {
  const b = el("button", { class: "btn ghost big", type: "button", text: "Check another image" });
  b.onclick = () => { clearPhoto(); $("upload-card").scrollIntoView({ behavior: "smooth", block: "start" }); $("choose").focus({ preventScroll: true }); };
  return el("div", { class: "result-actions" }, b);
}

function renderRejected() {
  $("result").replaceChildren(
    el("p", { class: "match-label", text: "We couldn't analyse this image" }),
    el("h3", { class: "match-name", text: "This doesn't look like a close-up of skin" }),
    el("p", { class: "muted", text: "The AI learned from close-up images of skin spots, like those taken in a skin clinic. This image looks different, so rather than guess, we've stopped here." }),
    el("div", { class: "block" }, el("h3", { text: "For a better result" }),
      el("ul", { class: "tips" },
        el("li", { text: "Take the image close up, with the skin spot in the middle and filling most of the picture." }),
        el("li", { text: "Use good, even light and keep the camera steady and in focus." }),
        el("li", { text: "If a spot is worrying you, a doctor can examine it properly with a skin magnifier." }))),
    anotherImageButton());
}

// ---------- result ----------
function confidence(p) {
  const level = p >= 0.7 ? ["High", 3] : p >= UNSURE_BELOW ? ["Moderate", 2] : ["Low", 1];
  const meter = el("span", { class: "meter", "aria-hidden": "true" }, ...[1, 2, 3].map((i) => el("span", { class: i <= level[1] ? "on" : "" })));
  return el("span", { class: "chip neutral" }, meter, `${level[0]} confidence (${whole(p)})`);
}

function render(r, truth) {
  const m = state.info, info = m.classes[r.top], care = info.care, top = r.probs[0], second = r.probs[1];
  const healthy = r.top === "healthy";
  let concern = care.level !== "selfcare", why = "", steps = care.steps, treatment = care.treatment;
  if (r.melanoma_warning && r.top !== "mel") {
    const pMel = r.probs.find((p) => p.code === "mel").p;
    concern = true;
    why = `It most closely matches ${lower(r.top)}, but it also shares some features with melanoma (${whole(pMel)} match).`;
    steps = m.classes.mel.care.steps;
    treatment = m.classes.mel.care.treatment;
  } else if (!concern && top.p < UNSURE_BELOW) {
    concern = true;
    why = `The AI isn't confident about this image. It could also be ${lower(second.code)} (${whole(second.p)} match).`;
  }

  const chip = concern ? el("span", { class: "chip info", text: "Worth discussing with a professional" })
    : healthy ? el("span", { class: "chip ok", text: "No skin spot found" })
    : el("span", { class: "chip ok", text: "Appears less concerning" });

  const next = el("div", { class: "next " + (concern ? "info" : "ok") },
    el("h3", { text: concern ? CONSIDER : care.headline }),
    concern ? el("p", { text: [why, SIMILAR].filter(Boolean).join(" ") }) : null,
    el("p", {}, el("b", { text: "What you can do now" })),
    el("ol", { class: "steps" }, ...steps.map((s) => el("li", { text: s }))));

  const bars = r.probs.map((p) => {
    const fill = el("span", { class: "fill" + (p.code === r.top ? " lead" : "") });
    fill.style.width = (p.p * 100).toFixed(1) + "%";
    return el("div", { class: "bar" }, el("span", { class: "lab", text: className(p.code) }),
      el("span", { class: "track" }, fill), el("span", { class: "val", text: pct(p.p) }));
  });

  $("result").replaceChildren(...[
    el("p", { class: "match-label", text: "Your image most closely matches" }),
    el("h3", { class: "match-name", text: info.name }),
    el("div", { class: "chips" }, chip, confidence(top.p)),
    truth ? el("p", { class: "truth", text: truth === r.top ? "This matches the confirmed answer for this example." : `The confirmed answer for this example is ${className(truth)}.` }) : null,

    el("div", { class: "block" }, el("h3", { text: "What this means" }),
      el("p", { text: info.about }),
      healthy ? null : el("p", { text: `It typically looks like ${care.looks}. These are general signs, not something the AI measured.` })),

    next,

    healthy ? null : el("div", { class: "block" }, el("h3", { text: "How it's usually managed" }), el("p", { text: treatment })),

    el("div", { class: "block" }, el("h3", { text: "When to talk to a doctor" }),
      el("p", { text: "Whatever the result, it's worth talking to a doctor if a skin spot:" }),
      el("ul", { class: "signs" }, ...m.urgent_signs.map((s) => el("li", { text: s.replace(/^It /, "") })))),

    el("details", { class: "fold" }, el("summary", { text: "See where the AI looked" }),
      el("div", { class: "seen" },
        el("img", { src: r.attention, alt: "Your image, with the areas the AI paid less attention to dimmed" }),
        el("div", {},
          el("p", { text: "The brighter area is the part of your image that most influenced the result. The rest is dimmed." }),
          el("p", { text: "If the bright area isn't on the skin spot itself, the result is less reliable." })))),

    el("details", { class: "fold" }, el("summary", { text: "See all possibilities" }),
      el("div", { class: "bars" }, ...bars)),

    el("p", { class: "disclaimer" }, el("b", { text: "This is an AI-based prediction, not a medical diagnosis. " }),
      "An AI prediction is only one piece of information. You're always welcome to ask a doctor about any skin concern."),
    anotherImageButton(),
  ].filter(Boolean));
}

// ---------- reliability ----------
function renderAccuracy(m) {
  const stat = (big, small) => el("div", { class: "stat" }, el("b", { text: big }), el("span", { text: small }));
  const pc = m.photo_check;
  $("acc-stats").replaceChildren(
    stat(whole(m.test.accuracy), "of test images were matched to the confirmed answer"),
    stat(whole(m.test.melanoma_recall_with_warning), "of melanomas were flagged as worth discussing with a professional"),
    stat(whole(pc.rejected_non_skin), "of non-skin images were recognised and not analysed"));
  $("warn-stats").replaceChildren(
    stat(whole(m.test.melanoma_recall_top_answer), "named as the closest match"),
    stat(whole(m.test.melanoma_recall_with_warning), "flagged, including shared features"),
    stat(whole(m.test.warning_on_non_melanoma), "of other images also flagged, to be safe"));
  $("warn-text").textContent = `Melanoma can look like other skin spots. So as well as the closest match, the AI flags any image that shares even a few features with melanoma ` +
    `(${pct(m.melanoma_threshold)} or more) as worth discussing with a professional. It's better to be careful.`;
  $("check-stats").replaceChildren(
    stat(whole(pc.rejected_non_skin), `of ${pc.non_skin_images} non-skin images set aside`),
    stat(whole(pc.rejected_test_lesions), "of real skin images set aside by mistake"));

  const head = el("tr", {}, el("th", { text: "Type" }), el("th", { text: "Test set 1" }), el("th", { text: "Test set 2" }));
  const rows = Object.keys(m.test.per_class_recall).map((c) => el("tr", {}, el("td", { text: className(c) }),
    el("td", { text: whole(m.test.per_class_recall[c]) }),
    el("td", { text: c in m.external.per_class_recall ? whole(m.external.per_class_recall[c]) : "not tested" })));
  $("recall-table").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
}

// ---------- examples (shown as names, not pictures) ----------
function renderExamples(info) {
  const src = (code) => `examples/${code}.jpg?v=${info.examples?.[code] ?? ""}`;
  for (const code of Object.keys(info.classes)) {
    const b = el("button", { type: "button", text: info.classes[code].name });
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
    setMode("signup");
    setUser(me.user);
  } catch {
    $("auth").hidden = false;
    authError("We can't reach the app right now. Please make sure run.bat (or python app/server.py) is still running.");
  }
})();
