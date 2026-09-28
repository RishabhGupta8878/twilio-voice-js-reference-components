// How each call status reads in the UI, and which colour its pill takes.
const STATUS_LABELS = {
  pending: 'Pending',
  idle: 'Ready',
  connecting: 'Connecting…',
  ringing: 'Ringing…',
  inprogress: 'On the call',
  incoming: 'Incoming call',
};

class TwilioVoiceDialer extends HTMLElement {
  static get observedAttributes() {
    return ['recipient', 'register'];
  }

  #call;
  // Extra parameters contributed by a slotted component, such as the emergency
  // location metadata. See setConnectParams().
  #connectParams = {};
  #device;
  #isRegistered = false;
  #recipient = '';
  #status = 'idle';
  #token;
  #validateConnectParams;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  async attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'recipient') {
      this.#recipient = newValue ?? '';
    }

    this.#render();

    if (name === 'register' && this.#device) {
      const shouldRegister = newValue === 'true';
      if (shouldRegister && !this.#isRegistered) {
        await this.#device.register();
        this.#isRegistered = true;
        this.#device.on('incoming', this.#handleIncoming);
      } else if (!shouldRegister && this.#isRegistered) {
        this.#device.unregister();
        this.#device.removeListener('incoming', this.#handleIncoming);
        this.#isRegistered = false;
      }
      this.#setStatus(this.#status);
    }

    const recipientEl = this.shadowRoot.querySelector('#recipient');
    recipientEl.addEventListener('input', (e) => {
      this.#recipient = e.target.value;
    });

    this.shadowRoot
      .querySelector('#accept')
      .addEventListener('click', () => this.#handleAccept());
    this.shadowRoot
      .querySelector('#call')
      .addEventListener('click', () => this.#handleCall());
    this.shadowRoot
      .querySelector('#hangup')
      .addEventListener('click', () => this.#handleHangup());
    this.shadowRoot
      .querySelector('#mute')
      .addEventListener('click', () => this.#handleMute(true));
    this.shadowRoot
      .querySelector('#unmute')
      .addEventListener('click', () => this.#handleMute(false));
    this.shadowRoot
      .querySelector('#register')
      .addEventListener('click', () => this.#handleRegister());
    this.shadowRoot
      .querySelector('#reject')
      .addEventListener('click', () => this.#handleReject());
  }

  #dispatchDeviceEvent(device) {
    const deviceEvent = new CustomEvent('device', {
      detail: { device },
    });
    this.dispatchEvent(deviceEvent);
  }

  #dispatchIncomingEvent(call) {
    const incomingEvent = new CustomEvent('incoming', {
      detail: { call },
    });
    this.dispatchEvent(incomingEvent);
  }

  #dispatchOutgoingEvent(call) {
    const outgoingEvent = new CustomEvent('outgoing', {
      detail: { call },
    });
    this.dispatchEvent(outgoingEvent);
  }

  #dispatchTokenWillExpireEvent(device) {
    const tokenWillExpireEvent = new CustomEvent('tokenWillExpire', {
      detail: { device },
    });
    this.dispatchEvent(tokenWillExpireEvent);
  }

  #handleAccept() {
    this.#call.accept();
    this.#setStatus('inprogress');
  }

  async #handleCall() {
    const params = { ...this.#connectParams };

    // When a slotted component supplies the number to dial, such as the
    // emergency component, the recipient input is not used.
    if (!params.To) {
      if (!this.#recipient) {
        this.#setError('recipient is required to make a call');
        return;
      }
      params.recipient = this.#recipient;
    }

    const validationError = this.#validateConnectParams?.(params);
    if (validationError) {
      this.#setError(validationError);
      return;
    }

    this.#setError('');
    this.#setStatus('connecting');

    try {
      this.#call = await this.#device.connect({ params });
      this.#dispatchOutgoingEvent(this.#call);
      this.#setupCallHandlers(this.#call);
      this.#setStatus('inprogress');
    } catch (error) {
      this.#setError(`unable to place the call: ${error.message}`);
      this.#setStatus('idle');
    }
  }

  #handleHangup() {
    this.#call.disconnect();
  }

  #handleIncoming = (call) => {
    this.#dispatchIncomingEvent(call);

    call.on('disconnect', this.#reset);
    call.on('cancel', this.#reset);
    call.on('reject', this.#reset);
    this.#call = call;
    this.#setStatus('incoming');
  };

  async #handleInit() {
    this.#device = new Twilio.Device(this.#token, {
      codecPreferences: ['opus', 'pcmu'],
      logLevel: 1,
    });
    this.#dispatchDeviceEvent(this.#device);
    this.#device.on('tokenWillExpire', (device) => {
      this.#dispatchTokenWillExpireEvent(device);
    });
    this.#device.on('error', (error) => {
      this.#setError(`device error ${error.code}: ${error.message}`);
    });
    this.#setStatus('idle');

    if (!this.#isRegistered && this.getAttribute('register') === 'true') {
      await this.#handleRegister();
    }
  }

  #handleMute(shouldMute) {
    this.#call.mute(shouldMute);
    this.#showButtons('hangup', shouldMute ? 'unmute' : 'mute');
  }

  async #handleRegister() {
    if (!this.#isRegistered) {
      this.setAttribute('register', 'true');
    } else {
      console.log('device is already registered');
    }
  }

  #handleReject() {
    this.#call.reject();
  }

  #render() {
    this.shadowRoot.innerHTML = `
      <style>
        /* Twilio Paste palette, https://paste.twilio.design/tokens */
        :host {
          --twilio-red: #f22f46;
          --twilio-navy: #121c2d;
          --blue-60: #0263e0;
          --blue-70: #034b9d;
          --green-60: #14b053;
          --red-60: #d61f1f;
          --gray-10: #f4f4f6;
          --gray-20: #e1e3ea;
          --gray-60: #606b85;
        }
        .container {
          display: block;
          font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
          color: var(--twilio-navy);
        }
        .statusbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--gray-20);
          background: var(--gray-10);
          border-radius: 999px;
          padding: 4px 12px 4px 9px;
          font-size: 12px;
          font-weight: 600;
          color: var(--gray-60);
        }
        .pill .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #aeb2c1;
        }
        #status[data-state='inprogress'] {
          background: #e8f6ed;
          border-color: #b8e3c8;
          color: #0b7a3a;
        }
        #status[data-state='inprogress'] .dot { background: var(--green-60); }
        #status[data-state='connecting'],
        #status[data-state='ringing'] {
          background: #fef8e1;
          border-color: #f2d48a;
          color: #8a5b00;
        }
        #status[data-state='connecting'] .dot,
        #status[data-state='ringing'] .dot {
          background: #e8a33d;
          animation: pulse 1.1s ease-in-out infinite;
        }
        #status[data-state='incoming'] {
          background: #e8f1fd;
          border-color: #bcd7f7;
          color: var(--blue-70);
        }
        #status[data-state='incoming'] .dot {
          background: var(--blue-60);
          animation: pulse 1.1s ease-in-out infinite;
        }
        #register-status[data-registered='true'] {
          background: #e8f6ed;
          border-color: #b8e3c8;
          color: #0b7a3a;
        }
        #register-status[data-registered='true'] .dot { background: var(--green-60); }
        @keyframes pulse {
          50% { opacity: 0.35; }
        }
        #recipient {
          font: inherit;
          font-size: 14px;
          padding: 8px 10px;
          border: 1px solid var(--gray-20);
          border-radius: 6px;
          min-width: 220px;
          box-sizing: border-box;
          margin-bottom: 10px;
        }
        #recipient:focus {
          outline: 2px solid var(--blue-60);
          outline-offset: -1px;
          border-color: var(--blue-60);
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        button,
        input[type='button'] {
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          align-items: center;
          gap: 7px;
          padding: 9px 16px;
          border-radius: 6px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: filter 0.12s ease, background 0.12s ease;
        }
        button:hover,
        input[type='button']:hover { filter: brightness(0.94); }
        button:active,
        input[type='button']:active { filter: brightness(0.88); }
        button:focus-visible,
        input[type='button']:focus-visible {
          outline: 2px solid var(--blue-60);
          outline-offset: 2px;
        }
        #call, #accept {
          background: var(--blue-60);
          color: #fff;
        }
        #accept { background: var(--green-60); }
        #hangup, #reject {
          background: var(--red-60);
          color: #fff;
        }
        #mute, #unmute {
          background: #fff;
          border-color: var(--gray-20);
          color: var(--twilio-navy);
        }
        #register {
          display: inline-flex;
          background: #fff;
          border-color: var(--gray-20);
          color: var(--twilio-navy);
        }
        #register[data-registered='true'] {
          border-color: #f7c2c8;
          color: #a3172a;
        }
        #error {
          display: flex;
          gap: 8px;
          background: #fdeced;
          border: 1px solid #f7c2c8;
          border-left: 4px solid var(--twilio-red);
          border-radius: 6px;
          color: #a3172a;
          font-size: 13px;
          line-height: 1.5;
          padding: 10px 12px;
          margin: 12px 0 0 0;
        }
        #error:empty { display: none; }
        #error::before { content: '⚠️'; }
      </style>
      <div class="container">
        <div class="statusbar">
          <span class="pill" id="status" data-state="pending">
            <span class="dot"></span>Pending
          </span>
          <span
            class="pill"
            id="register-status"
            data-registered="${this.getAttribute('register') === 'true'}"
          >
            <span class="dot"></span>${
              this.getAttribute('register') === 'true' ? 'Registered' : 'Not registered'
            }
          </span>
        </div>
        <input 
          type="text"
          placeholder="recipient"
          id="recipient"
          value="${this.#recipient}"
        />
        <div class="actions">
          <button id="call" style="display: none;">📞 Call</button>
          <button id="hangup" style="display: none;">🔴 Hang up</button>
          <button id="mute" style="display: none;">🔇 Mute</button>
          <button id="unmute" style="display: none;">🔊 Unmute</button>
          <button id="accept" style="display: none;">✅ Accept</button>
          <button id="reject" style="display: none;">🚫 Reject</button>
          <input
            type="button"
            id="register"
            data-registered="${this.getAttribute('register') === 'true'}"
            value="${
              this.getAttribute('register') === 'true' ? '🔓 Unregister' : '🔐 Register'
            }"
          />
        </div>
        <p id="error"></p>
        <slot></slot>
      </div>
    `;
    this.#showRecipientInput(!this.#connectParams.To);
  }

  #reset = () => {
    this.#setStatus('idle');
    this.#call = null;
  };

  #setError(message) {
    const errorEl = this.shadowRoot.querySelector('#error');
    if (errorEl) {
      errorEl.innerText = message;
    }
    if (message) {
      console.error(message);
    }
  }

  #setStatus(status) {
    this.#status = status;
    if (this.#status === 'idle') {
      this.#showButtons('call');
    } else if (this.#status === 'incoming') {
      this.#showButtons('accept', 'reject');
    } else if (this.#status === 'connecting') {
      this.#showButtons();
    } else if (this.#status === 'ringing') {
      this.#showButtons('hangup');
    } else if (this.#status === 'inprogress') {
      this.#showButtons('hangup', 'mute');
    }

    const statusEl = this.shadowRoot.querySelector('#status');
    statusEl.dataset.state = this.#status;
    statusEl.innerHTML = `<span class="dot"></span>${
      STATUS_LABELS[this.#status] ?? this.#status
    }`;
  }

  #setupCallHandlers(call) {
    call.on('ringing', () => {
      this.#setStatus('ringing');
    });
    call.on('accept', () => {
      this.#setStatus('inprogress');
    });
    call.on('error', (error) => {
      this.#setError(`call error ${error.code}: ${error.message}`);
    });
    call.on('disconnect', () => {
      this.#setStatus('idle');
    });
  }

  #showButtons(...buttonsToShow) {
    this.shadowRoot.querySelectorAll('button').forEach((el) => {
      if (buttonsToShow.includes(el.id)) {
        el.style.display = 'inline-flex';
      } else {
        el.style.display = 'none';
      }
    });
  }

  #showRecipientInput(shouldShow) {
    this.shadowRoot.querySelector('#recipient').style.display = shouldShow
      ? 'inline-block'
      : 'none';
  }

  /**
   * Used by a slotted component, such as twilio-voice-emergency, to add its own
   * parameters to device.connect(). Passing a `To` parameter means the slotted
   * component supplies the number to dial and the recipient input is hidden.
   *
   * @param {object} params parameters to send with the next outgoing call
   * @param {object} [options]
   * @param {function} [options.validate] returns an error message when the
   *   call should not be placed, or a falsy value when the params are valid
   */
  setConnectParams(params = {}, { validate } = {}) {
    this.#connectParams = { ...params };
    this.#validateConnectParams = validate;
    this.#showRecipientInput(!this.#connectParams.To);
  }

  setToken(token) {
    if (this.#token) {
      this.#device.updateToken(token);
    } else {
      this.#token = token;
      this.#handleInit();
    }
  }
}

customElements.define('twilio-voice-dialer', TwilioVoiceDialer);
