// TEMPORARY SANDBOX - simulates the full checkout flow without real keys.
// Auto-activated by SmartPaywall when NEXT_PUBLIC_RAZORPAY_KEY_ID is not set.
// Also used by Android debug builds so no real payment SDK opens in the APK.

const STYLES = `
  #mock-rzp-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center; padding: 16px;
    animation: mockFadeIn 0.18s ease;
  }
  #mock-rzp-card {
    background: #fff; border-radius: 16px; width: 100%; max-width: 420px;
    box-shadow: 0 40px 100px rgba(0,0,0,0.35);
    overflow: hidden; position: relative;
  }
  #mock-rzp-header {
    background: linear-gradient(135deg, #3395FF 0%, #2C7BE5 100%);
    padding: 20px 24px 18px; color: #fff; position: relative;
  }
  #mock-rzp-sandbox-badge {
    display: inline-block;
    background: rgba(255, 210, 0, 0.92); color: #1a1a00;
    font-size: 10px; font-weight: 800;
    padding: 2px 9px; border-radius: 20px;
    letter-spacing: 0.1em; text-transform: uppercase;
    margin-bottom: 10px;
  }
  #mock-rzp-brand { font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.95); }
  #mock-rzp-amount { font-size: 30px; font-weight: 800; color: #fff; margin-top: 6px; letter-spacing: -0.02em; }
  #mock-rzp-desc { font-size: 12px; color: rgba(255,255,255,0.72); margin-top: 3px; }
  #mock-rzp-close-btn {
    position: absolute; top: 14px; right: 16px;
    background: rgba(255,255,255,0.18); border: none;
    width: 28px; height: 28px; border-radius: 50%;
    color: #fff; cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s; line-height: 1;
  }
  #mock-rzp-close-btn:hover { background: rgba(255,255,255,0.32); }
  #mock-rzp-body { padding: 22px 24px 24px; }
  .mock-rzp-field { margin-bottom: 14px; }
  .mock-rzp-label {
    display: block; font-size: 11px; font-weight: 700; color: #64748B;
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px;
  }
  .mock-rzp-input {
    width: 100%; padding: 10px 12px; font-size: 14px;
    border: 1.5px solid #E2E8F0; border-radius: 8px;
    background: #F8FAFC; color: #0F1923;
    box-sizing: border-box; font-family: 'JetBrains Mono', monospace;
    outline: none; transition: border 0.15s; cursor: default;
  }
  .mock-rzp-input:focus { border-color: #3395FF; background: #fff; }
  .mock-rzp-row { display: flex; gap: 12px; }
  .mock-rzp-row .mock-rzp-field { flex: 1; }
  #mock-rzp-pay-btn {
    width: 100%; padding: 14px; margin-top: 6px;
    background: linear-gradient(135deg, #3395FF, #2C7BE5);
    color: #fff; border: none; border-radius: 10px;
    font-size: 14px; font-weight: 700; cursor: pointer;
    letter-spacing: 0.02em; transition: opacity 0.15s, transform 0.1s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  #mock-rzp-pay-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  #mock-rzp-fail-btn {
    width: 100%; padding: 10px; margin-top: 8px;
    background: transparent; color: #94A3B8;
    border: 1px dashed #CBD5E1; border-radius: 10px;
    font-size: 12px; cursor: pointer; transition: all 0.15s;
  }
  #mock-rzp-fail-btn:hover { color: #DC2626; border-color: #FCA5A5; background: #FEF2F2; }
  #mock-rzp-processing { display: none; text-align: center; padding: 16px 0 8px; }
  #mock-rzp-processing span { font-size: 13px; color: #3395FF; font-weight: 600; vertical-align: middle; margin-left: 8px; }
  #mock-rzp-footer {
    margin-top: 16px; display: flex; align-items: center; justify-content: center;
    gap: 6px; color: #94A3B8; font-size: 11px;
  }
  @keyframes mockFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mockSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
`;

function shouldShowFailureSimulation() {
  try {
    return (
      window.localStorage?.getItem("edgeciplineSandboxPaymentFailures") === "1" ||
      new URLSearchParams(window.location.search).get("sandboxPaymentFailures") === "1"
    );
  } catch {
    return false;
  }
}

class MockRazorpay {
  constructor(options) {
    this.options = options;
    this._onFail = null;
  }

  on(event, cb) {
    if (event === "payment.failed") this._onFail = cb;
  }

  open() {
    const amountRupees = Math.round((this.options.amount || 15000) / 100);
    const desc = this.options.description || "Premium Subscription";
    const allowFailureSimulation = shouldShowFailureSimulation();
    const failureButton = allowFailureSimulation
      ? `<button id="mock-rzp-fail-btn">Simulate Payment Failure</button>`
      : "";

    const overlay = document.createElement("div");
    overlay.id = "mock-rzp-overlay";
    overlay.innerHTML = `
      <style>${STYLES}</style>
      <div id="mock-rzp-card">
        <div id="mock-rzp-header">
          <button id="mock-rzp-close-btn" aria-label="Close">x</button>
          <div id="mock-rzp-sandbox-badge">Sandbox Mode</div>
          <div id="mock-rzp-brand">Demo Checkout</div>
          <div id="mock-rzp-amount">Rs ${amountRupees}</div>
          <div id="mock-rzp-desc">${desc}</div>
        </div>
        <div id="mock-rzp-body">
          <div class="mock-rzp-field">
            <label class="mock-rzp-label">Card Number</label>
            <input class="mock-rzp-input" value="4111 1111 1111 1111" readonly />
          </div>
          <div class="mock-rzp-row">
            <div class="mock-rzp-field">
              <label class="mock-rzp-label">Expiry</label>
              <input class="mock-rzp-input" value="12 / 29" readonly />
            </div>
            <div class="mock-rzp-field">
              <label class="mock-rzp-label">CVV</label>
              <input class="mock-rzp-input" value="123" readonly />
            </div>
          </div>
          <div id="mock-rzp-processing">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3395FF" stroke-width="2.5"
              style="animation:mockSpin 0.8s linear infinite;display:inline-block;vertical-align:middle">
              <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
            </svg>
            <span>Processing payment...</span>
          </div>
          <button id="mock-rzp-pay-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            Pay Rs ${amountRupees}
          </button>
          ${failureButton}
          <div id="mock-rzp-footer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Demo sandbox - no real charge
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlay = overlay;

    overlay.querySelector("#mock-rzp-close-btn").addEventListener("click", () => this._close());
    overlay.querySelector("#mock-rzp-pay-btn").addEventListener("click", () => this._startSuccess());
    overlay.querySelector("#mock-rzp-fail-btn")?.addEventListener("click", () => this._doFail());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this._close(); });
  }

  _startSuccess() {
    const body = this._overlay.querySelector("#mock-rzp-body");
    body.querySelector("#mock-rzp-pay-btn").style.display = "none";
    const failButton = body.querySelector("#mock-rzp-fail-btn");
    if (failButton) failButton.style.display = "none";
    body.querySelector("#mock-rzp-processing").style.display = "block";

    setTimeout(() => {
      this._close({ notifyDismiss: false });
      if (typeof this.options.handler === "function") {
        this.options.handler({
          razorpay_order_id: this.options.order_id,
          razorpay_payment_id: `sandbox_pay_${Date.now()}`,
          razorpay_signature: `sandbox_sig_${Math.random().toString(36).slice(2)}`,
        });
      }
    }, 1800);
  }

  _doFail() {
    this._close({ notifyDismiss: false });
    if (typeof this._onFail === "function") {
      this._onFail({ error: { description: "Sandbox: Payment declined by test issuer" } });
    }
  }

  _close({ notifyDismiss = true } = {}) {
    if (this._overlay?.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;
    if (notifyDismiss && typeof this.options.modal?.ondismiss === "function") {
      this.options.modal.ondismiss();
    }
  }
}

export function injectMockRazorpay() {
  if (typeof window !== "undefined") {
    window.Razorpay = MockRazorpay;
  }
}
