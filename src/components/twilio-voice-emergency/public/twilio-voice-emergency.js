// Emergency location metadata sent to the emergency provider. The maximum
// lengths are the ones the Conference Participant resource keeps, longer values
// are truncated by the API. The values are prefilled with Twilio's own address
// so that the form can be submitted as-is against the 933 test number.
// https://www.twilio.com/docs/voice/api/conference-participant-resource
const EMERGENCY_FIELDS = [
  {
    name: 'emergencyCallerPosition',
    label: 'Caller position',
    hint: 'latitude longitude, in decimal degrees',
    maxLength: 150,
    value: '37.7749 -122.4194',
  },
  {
    name: 'emergencyCallerLocation',
    label: 'Location in building',
    hint: 'where to find the caller once on site',
    maxLength: 20,
    value: 'Floor 3 Cubicle 2',
  },
  {
    name: 'emergencyName',
    label: 'Name',
    maxLength: 20,
    value: 'Twilio Inc',
  },
  {
    name: 'emergencyAddress',
    label: 'Street address',
    maxLength: 60,
    value: '101 Spear Street',
  },
  {
    name: 'emergencyZipCode',
    label: 'Zip code',
    maxLength: 20,
    value: '94105',
  },
  {
    name: 'emergencyCity',
    label: 'City',
    maxLength: 20,
    value: 'San Francisco',
  },
  {
    name: 'emergencyState',
    label: 'State',
    maxLength: 20,
    value: 'CA',
  },
  {
    name: 'emergencyCountry',
    label: 'Country',
    maxLength: 20,
    value: 'US',
    // The emergency parameters currently support US and CA only.
    options: ['US', 'CA'],
  },
];

// The three legs of the conference, in the order they are added.
const ROLES = [
  {
    emoji: '📞',
    name: 'Caller',
    detail: 'this browser',
    matches: (label) => label.endsWith('-caller'),
  },
  {
    emoji: '🛡️',
    name: 'Security agent',
    detail: 'the escalation target',
    matches: (label) => label.endsWith('-agent'),
  },
  {
    emoji: '🚨',
    name: 'Emergency provider',
    detail: 'receives the location metadata',
    matches: (label) => label === 'emergency-provider',
  },
];

// Numbers that route to an emergency provider, optionally with a country code.
const EMERGENCY_NUMBER = /^\+?\d{0,2}(911|933)$/;

class TwilioVoiceEmergency extends HTMLElement {
  #call;
  #participants = new Map();

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.#render();

    this.#twilioVoiceDialer.addEventListener('outgoing', (e) => {
      this.#setCallHandlers(e.detail.call);
    });

    this.shadowRoot.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', () => this.#updateConnectParams());
    });

    // Hand the emergency parameters to the softphone so that they are sent with
    // the next outgoing call.
    this.#updateConnectParams();
  }

  get #twilioVoiceDialer() {
    return this.shadowRoot.host.parentElement;
  }

  #getConnectParams() {
    const emergencyParams = EMERGENCY_FIELDS.reduce((params, { name }) => {
      const value = this.shadowRoot.querySelector(`#${name}`).value.trim();
      if (value) {
        params[name] = value;
      }
      return params;
    }, {});

    return {
      // The emergency provider, dialed by the softphone.
      To: this.shadowRoot.querySelector('#emergencyNumber').value.trim(),
      // The agent the emergency call is escalated to, added to the conference
      // by the TwiML handler.
      Agent: this.shadowRoot.querySelector('#agent').value.trim(),
      ...emergencyParams,
    };
  }

  #handleCallMessageReceived(message) {
    const { content, messageType } = message;
    if (messageType !== 'user-defined-message' || content.category !== 'conference-status') {
      return;
    }

    const { callSid, hold, label, muted, remove } = content;
    if (remove) {
      this.#participants.delete(callSid);
    } else {
      this.#participants.set(callSid, { hold, label, muted });
    }
    this.#renderParticipants();
  }

  #render() {
    const field = ({ hint, label, maxLength, name, options, value }) => `
      <div class="field">
        <label for="${name}">
          ${label}
          <span class="limit">max ${maxLength}</span>
        </label>
        ${options
          ? `<select id="${name}">
              ${options
                .map(
                  (option) =>
                    `<option value="${option}"${
                      option === value ? ' selected' : ''
                    }>${option}</option>`
                )
                .join('')}
            </select>`
          : `<input
              type="text"
              id="${name}"
              maxlength="${maxLength}"
              placeholder="${value}"
              value="${value}"
            />`}
        ${hint ? `<span class="hint">${hint}</span>` : ''}
      </div>
    `;

    this.shadowRoot.innerHTML = `
      <style>
        /* Twilio Paste palette, https://paste.twilio.design/tokens */
        :host {
          --twilio-red: #f22f46;
          --twilio-navy: #121c2d;
          --border: #e1e3ea;
          --muted: #606b85;
          display: block;
          font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
          color: var(--twilio-navy);
          margin-top: 16px;
        }
        section {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px 18px;
          margin-bottom: 12px;
        }
        section.locate {
          border-left: 4px solid var(--twilio-red);
        }
        h3 {
          font-size: 15px;
          margin: 0 0 2px 0;
          letter-spacing: -0.01em;
        }
        .section-hint {
          color: var(--muted);
          font-size: 13px;
          margin: 0 0 14px 0;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px 16px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        label {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .limit {
          font-weight: 400;
          font-size: 11px;
          text-transform: none;
          letter-spacing: 0;
          color: #9aa0a6;
        }
        input,
        select {
          font: inherit;
          font-size: 14px;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: #fff;
          color: inherit;
          width: 100%;
          box-sizing: border-box;
        }
        input:focus,
        select:focus {
          outline: 2px solid #0263e0;
          outline-offset: -1px;
          border-color: #0263e0;
        }
        input:hover,
        select:hover {
          border-color: #aeb2c1;
        }
        .hint {
          font-size: 12px;
          color: var(--muted);
        }
        .roster {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .roster li {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 2px;
          border-bottom: 1px solid var(--border);
        }
        .avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: #f4f4f6;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex: none;
        }
        li.connected .avatar {
          background: #e8f6ed;
        }
        li.provider.connected .avatar {
          background: #fdeced;
        }
        .roster li:last-child {
          border-bottom: 0;
        }
        .dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #cacdd8;
          flex: none;
        }
        li.connected .dot {
          background: #14b053;
        }
        li.provider.connected .dot {
          background: var(--twilio-red);
        }
        .role {
          font-size: 14px;
        }
        .role small {
          display: block;
          color: var(--muted);
          font-size: 12px;
        }
        .state {
          margin-left: auto;
          font-size: 12px;
          color: var(--muted);
          text-align: right;
        }
        li.connected .state {
          color: var(--twilio-navy);
          font-weight: 600;
        }
      </style>

      <section>
        <h3>☎️ Call setup</h3>
        <p class="section-hint">
          The softphone dials the emergency number. The agent is added to the same
          conference by the TwiML handler.
        </p>
        <div class="grid">
          <div class="field">
            <label for="emergencyNumber">
              Emergency number
              <span class="limit">911 or 933</span>
            </label>
            <input type="text" id="emergencyNumber" value="933" placeholder="933" />
            <span class="hint">933 is Twilio's test number and reads the location back</span>
          </div>
          <div class="field">
            <label for="agent">Agent to escalate to</label>
            <input type="text" id="agent" value="bob" placeholder="bob or +12345678900" />
            <span class="hint">a client identity, or a phone number in E.164</span>
          </div>
        </div>
      </section>

      <section class="locate">
        <h3>📍 Caller location</h3>
        <p class="section-hint">
          Sent to the emergency provider on its conference participant. Every field
          is required.
        </p>
        <div class="grid">
          ${EMERGENCY_FIELDS.map(field).join('')}
        </div>
      </section>

      <section>
        <h3>👥 On the call</h3>
        <p class="section-hint">Updated live from the conference status events.</p>
        <ul class="roster" id="participants"></ul>
      </section>
    `;

    this.#renderParticipants();
  }

  #renderParticipants() {
    const participants = [...this.#participants.values()];

    this.shadowRoot.querySelector('#participants').innerHTML = ROLES.map(
      ({ detail, emoji, matches, name }, index) => {
        const participant = participants.find(({ label }) => matches(label || ''));
        const state = participant
          ? [
              participant.hold ? 'on hold' : null,
              participant.muted ? 'muted' : null,
            ]
              .filter(Boolean)
              .join(', ') || 'on the call'
          : 'waiting';

        return `
          <li class="${participant ? 'connected' : ''} ${index === 2 ? 'provider' : ''}">
            <span class="dot"></span>
            <span class="avatar">${emoji}</span>
            <span class="role"><span class="role-name">${name}</span><small>${detail}</small></span>
            <span class="state">${state}</span>
          </li>
        `;
      }
    ).join('');
  }

  #reset = () => {
    this.#call = undefined;
    this.#participants = new Map();
    this.#renderParticipants();
  };

  #setCallHandlers = (call) => {
    this.#call = call;
    this.#call.on('disconnect', this.#reset);
    this.#call.on('cancel', this.#reset);
    this.#call.on('reject', this.#reset);
    this.#call.on('messageReceived', (message) =>
      this.#handleCallMessageReceived(message)
    );
  };

  #updateConnectParams() {
    this.#twilioVoiceDialer.setConnectParams(this.#getConnectParams(), {
      validate: (params) => this.#validate(params),
    });
  }

  /**
   * An emergency call is only useful to the emergency provider when it carries
   * the caller's location, so every parameter is required here.
   */
  #validate(params) {
    if (!EMERGENCY_NUMBER.test(params.To)) {
      return 'emergency number must be 911 or 933';
    }
    if (!params.Agent) {
      return 'agent to escalate to is required';
    }

    const missing = EMERGENCY_FIELDS.filter(({ name }) => !params[name]);
    if (missing.length > 0) {
      return `emergency details are required: ${missing
        .map(({ label }) => label.toLowerCase())
        .join(', ')}`;
    }

    return '';
  }
}

customElements.define('twilio-voice-emergency', TwilioVoiceEmergency);
