import { Router } from 'express';
import Twilio from 'twilio';
import config from '../../config.js';
import {
  tokenHandler,
  conferenceEventsHandler,
  twimlHandler,
} from '../../common/routes.js';

const router = Router();
const { authToken } = config;
const componentUrl = 'twilio-voice-emergency';

// Add your own authentication mechanism here to make sure this endpoint is only accessible to authorized users.
router.get('/token', (req, res) => tokenHandler(req, res));

// Validate incoming Twilio requests
// https://www.twilio.com/docs/usage/tutorials/how-to-secure-your-express-app-by-validating-incoming-twilio-requests
router.post('/twiml', Twilio.webhook({ protocol: 'https' }, authToken), (req, res) =>
  twimlHandler(
    req,
    res,
    componentUrl,
    {
      callerLabel: 'caller',
      // The callee of an emergency call is the agent the call is escalated to,
      // such as on-site security.
      calleeLabel: 'agent',
      // The caller, the agent, the emergency provider, and room for one more
      // participant such as a supervisor.
      maxParticipants: 4,
      // Keep the agent and the emergency provider connected when the caller
      // drops off the call.
      endConferenceOnExit: false,
      statusCallbackEvent: 'start, end, join, leave, mute, hold',
    }
  )
);

// Validate incoming Twilio requests
// https://www.twilio.com/docs/usage/tutorials/how-to-secure-your-express-app-by-validating-incoming-twilio-requests
router.post('/conference-events', Twilio.webhook({ protocol: 'https' }, authToken), (req, res) =>
  conferenceEventsHandler(
    req,
    res,
    componentUrl,
    {
      // Sent to the client legs so the softphone can show who is on the call.
      statusCallbackEvents: [
        'participant-join',
        'participant-mute',
        'participant-unmute',
        'participant-hold',
        'participant-unhold',
        'participant-leave',
      ],
    }
  )
);

export default router;
