## Twilio Voice JavaScript Reference Components

Twilio Voice JavaScript Reference Components leverages [Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components) to showcase integrated backend and frontend implementations for common Twilio Voice use cases. Please visit the official [developer documentation](https://www.twilio.com/docs/voice/sdks/javascript/reference-components) for more details.

## Use cases

The reference components demonstrate several common Twilio Voice use cases. These use cases include:

- Dialer
  - Place outgoing calls
  - Receive incoming calls
- Basic Call Control (uses Conference)
  - Perform cold or warm transfers
  - Add or remove participants from a call
  - Hold and Resume a call
  - Mute and Unmute a call
- Monitoring (uses Conference)
  - Observe call progress
  - Track conference call status
  - View quality metrics
  - Receive warnings
  - View errors
- Emergency Conference (uses Conference)
  - Make emergency calls (933/911) with security agent escalation
  - Pass emergency location metadata (GPS coordinates, address, etc.)
  - Track emergency parameters through conference lifecycle
  - Multi-party conference with caller, emergency provider, and security agent
- Voice AI Conversation
  - Place an outbound call and connect to an agent
  - Provide a Websocket server to interface with Conversation Relay
  - Basic OpenAI integration

## Installation

1. Clone the [Twilio Voice JavaScript Reference Components](https://github.com/twilio/twilio-voice-js-reference-components) GitHub repository.

```bash
git clone https://github.com/twilio/twilio-voice-js-reference-components.git
```

2. Install the dependencies.

```bash
npm install
```

3. Copy `example.env` to `.env`, then supply the required values. For details about each variable, see the [quickstart](https://www.twilio.com/docs/voice/sdks/javascript/get-started).

```bash
cp example.env .env
```

4. In the Twilio Console, open your **TwiML App** settings and set **Voice Request URL** to the endpoint for the component you want to test:

```text
https://yourdomain/twilio-voice-dialer/twiml
https://yourdomain/twilio-voice-basic-call-control/twiml
https://yourdomain/twilio-voice-monitoring/twiml
https://yourdomain/twilio-voice-emergency/twiml
https://yourdomain/twilio-voice-ai-conversation/twiml
```

## Run the project locally

1. Start the local server under the `twilio-voice-js-reference-components` folder.

```bash
npm start
```

2. Open a browser and navigate to a component URL.

- Dialer: [http://localhost:3030/twilio-voice-dialer?identity=bob](http://localhost:3030/twilio-voice-dialer?identity=bob).
- Basic Call Control: [http://localhost:3030/twilio-voice-basic-call-control?identity=bob](http://localhost:3030/twilio-voice-basic-call-control?identity=bob).
- Monitoring: [http://localhost:3030/twilio-voice-monitoring?identity=bob](http://localhost:3030/twilio-voice-monitoring?identity=bob).
- Emergency Conference: [http://localhost:3030/twilio-voice-emergency?identity=bob](http://localhost:3030/twilio-voice-emergency?identity=bob).
- Voice AI Conversation: [http://localhost:3030/twilio-voice-ai-conversation?identity=bob](http://localhost:3030/twilio-voice-ai-conversation?identity=bob).

## Emergency Conference

Make emergency calls (933/911) with simultaneous connection to a security agent, and deliver the caller's location to the emergency provider.

The `twilio-voice-emergency` component slots into the `twilio-voice-dialer` softphone, the same way the other components do:

```html
<twilio-voice-dialer recipient register>
  <twilio-voice-emergency></twilio-voice-emergency>
</twilio-voice-dialer>
```

It collects the emergency number, the agent to escalate to, and the location metadata, validates them, and hands them to the softphone with `setConnectParams()`. The softphone sends them with the outgoing call, and hides its recipient input because the component supplies the number to dial.

### How Emergency Details Are Passed

#### 1. Client Side - the softphone sends the parameters with `device.connect()`

```javascript
const call = await device.connect({
  params: {
    To: '933',                             // Emergency number
    Agent: 'bob',                          // Security agent
    emergencyCallerPosition: '37.7749 -122.4194', // GPS coordinates
    emergencyCallerLocation: 'Floor 3 Cubicle 2',
    emergencyName: 'Twilio Inc',
    emergencyAddress: '101 Spear Street',
    emergencyZipCode: '94105',
    emergencyCity: 'San Francisco',
    emergencyState: 'CA',
    emergencyCountry: 'US'
  }
});
```

#### 2. Server Side - the TwiML handler reads them off the request

Parameters are received in `req.body` at the TwiML endpoint (`/twilio-voice-emergency/twiml`) and extracted by `extractEmergencyParams()` in `src/common/emergency.js`. They are also appended to the conference `statusCallback` URL, so every conference event carries the caller's location.

#### 3. The emergency provider participant is created with the parameters

```javascript
client.conferences(roomName).participants.create({
  beep: 'false',
  from: callerId,
  to: dialedNumber, // e.g. 933
  label: 'emergency-provider',
  startConferenceOnEnter: true,
  endConferenceOnExit: false,
  // Emergency location metadata, delivered to the emergency provider
  ...emergencyParams,
});
```

**Note:** the emergency parameters require the `twilio` helper library v6 or later. Earlier versions silently drop them from the request.

### Parameter limits

The API truncates values longer than the maximum length, and supports `US` and `CA` for the country.

| Parameter | Max length | Example |
| --- | --- | --- |
| `emergencyCallerPosition` | 150 | `37.7749 -122.4194` (latitude longitude, decimal degrees) |
| `emergencyCallerLocation` | 20 | `Floor 3 Cubicle 2` |
| `emergencyName` | 20 | `Twilio Inc` |
| `emergencyAddress` | 60 | `101 Spear Street` |
| `emergencyZipCode` | 20 | `94105` |
| `emergencyCity` | 20 | `San Francisco` |
| `emergencyState` | 20 | `CA` |
| `emergencyCountry` | 20 | `US` |

### Who is on the call

The conference has three legs: the caller (the softphone), the security agent (`Agent`), and the emergency provider (the dialed `To`). The component lists the participants as they join, using the conference status events sent back to the client leg. The caller leg uses `endConferenceOnExit: false`, so the agent and the emergency provider stay connected if the caller drops off.

### Quick Test

1. Start server: `npm start`
2. Open [http://localhost:3030/twilio-voice-emergency?identity=bob](http://localhost:3030/twilio-voice-emergency?identity=bob)
3. Fill in the agent and the emergency details
4. Click "Call"
5. Check the server console for the emergency parameter logs

933 is Twilio's emergency calling test number: it reads back the location Twilio has for the call, which is how you confirm the parameters arrived. The caller ID must have a registered emergency address.

### Configuration

Set TwiML App Voice Request URL in Twilio Console:
```
https://yourdomain/twilio-voice-emergency/twiml
```
