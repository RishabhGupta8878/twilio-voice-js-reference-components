import crypto from 'crypto';
import Twilio from 'twilio';
import config from '../config.js';
import { isPhoneNumber } from './utils.js';
import {
  appendEmergencyParams,
  extractEmergencyParams,
  isEmergencyNumber,
} from './emergency.js';

const AccessToken = Twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const VoiceResponse = Twilio.twiml.VoiceResponse;

const {
  accountSid,
  appSid,
  apiKeySecret,
  apiKeySid,
  callbackBaseUrl,
  callerId,
  defaultIdentity,
} = config;
const client = Twilio(apiKeySid, apiKeySecret, { accountSid });

/**
 * Generate a Twilio access token for the component.
 */
export const tokenHandler = (req, res) => {
  const identity = req.query.identity || defaultIdentity;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });
  const voiceGrant = new VoiceGrant({
    incomingAllow: Boolean(identity),
    outgoingApplicationSid: appSid,
  });

  token.addGrant(voiceGrant);
  res.send({ token: token.toJwt() });
};

/**
 * Handler for the TwiML App Webhook, set in the User's Twilio Console.
 */
export const twimlHandler = (req, res, componentUrl, options = {}) => {
  const {
    calleeStatusCallbackEvent = [],
    calleeLabel = 'callee',
    callerLabel = 'caller',
    endConferenceOnExit = true,
    maxParticipants = 4,
    statusCallbackEvent = '',
  } = options;
  const twiml = new VoiceResponse();
  const dial = twiml.dial();

  // Location metadata sent by the softphone with device.connect({ params }).
  const emergencyParams = extractEmergencyParams(req);
  // The number the softphone dialed. For the emergency use case this is the
  // emergency provider, such as 933 or 911.
  const dialedNumber = req.body.To;
  const isEmergencyCall = isEmergencyNumber(dialedNumber);

  // Generates 1:1 conference
  const roomName = `conference-${crypto.randomUUID()}`;

  // The callee is sent as `recipient` by the dialer, and as `Agent` by the
  // emergency softphone, where the dialed number is the emergency provider.
  let recipient =
    req.body.recipient || req.body.Agent || req.query.recipient || defaultIdentity;
  recipient = isPhoneNumber(recipient) ? recipient : 'client:' + recipient;

  // Forward the emergency metadata to the conference statusCallback so that
  // every conference event can be logged or alerted on with the caller's
  // location.
  const statusCallbackUrl = appendEmergencyParams(
    new URL(`https://${callbackBaseUrl}/${componentUrl}/conference-events`),
    emergencyParams
  );

  console.log(`[${componentUrl}] twiml`, {
    conference: roomName,
    from: req.body.From,
    to: dialedNumber,
    recipient,
    ...(isEmergencyCall ? { emergency: emergencyParams } : {}),
  });

  // The caller creates the conference
  dial.conference(
    {
      beep: 'false',
      endConferenceOnExit,
      maxParticipants,
      // Label to identify this participant
      participantLabel: `${
        isPhoneNumber(req.body.From) ? 'number' : 'client'
      }-${callerLabel}`,
      startConferenceOnEnter: true,
      statusCallback: statusCallbackUrl.toString(),
      statusCallbackEvent,
      waitUrl: '',
    },
    roomName
  );

  // Add the callee to the conference. For an emergency call this is the agent
  // the call is escalated to, such as on-site security.
  client.conferences(roomName).participants.create({
    beep: 'false',
    endConferenceOnExit: false,
    startConferenceOnEnter: true,
    from: callerId,
    // Label to identify this participant
    label: `${isPhoneNumber(recipient) ? 'number' : 'client'}-${calleeLabel}`,
    // Callee's progress/status
    // https://www.twilio.com/docs/voice/api/conference-participant-resource#request-body-parameters
    statusCallback:
      calleeStatusCallbackEvent.length > 0
        ? `https://${callbackBaseUrl}/${componentUrl}/call-events`
        : '',
    statusCallbackEvent: calleeStatusCallbackEvent,
    to: recipient,
  })
  .catch((error) => {
    console.error(`[${componentUrl}] unable to add ${calleeLabel} to the conference:`, {
      code: error.code,
      message: error.message,
      moreInfo: error.moreInfo,
      to: recipient,
    });
  });

  // Add the emergency provider (933/911) to the conference, along with the
  // caller's location metadata.
  // https://www.twilio.com/docs/voice/api/conference-participant-resource
  if (isEmergencyCall) {
    client.conferences(roomName).participants.create({
      beep: 'false',
      endConferenceOnExit: false,
      startConferenceOnEnter: true,
      from: callerId,
      label: 'emergency-provider',
      to: dialedNumber,
      // Emergency location metadata, delivered to the emergency provider.
      // Requires the twilio helper library v6 or later.
      ...emergencyParams,
    })
    .catch((error) => {
      console.error(`[${componentUrl}] unable to add the emergency provider to the conference:`, {
        code: error.code,
        message: error.message,
        moreInfo: error.moreInfo,
        to: dialedNumber,
      });
    });
  }

  res.header('Content-Type', 'text/xml').status(200).send(twiml.toString());
};

/**
 * Handler for the Twilio Conference statusCallback.
 */
export const conferenceEventsHandler = async (req, res, componentUrl, options = {}) => {
  const {
    CallSid,
    ConferenceSid,
    Hold,
    Muted,
    ParticipantLabel,
    StatusCallbackEvent,
  } = req.body;
  const {
    statusCallbackEvents = [],
  } = options;

  // The emergency metadata is carried on the statusCallback URL, see twimlHandler.
  const emergencyParams = extractEmergencyParams(req);

  if (Object.keys(emergencyParams).length > 0) {
    console.log(`[${componentUrl}] emergency conference event`, {
      conferenceSid: ConferenceSid,
      participantLabel: ParticipantLabel,
      statusCallbackEvent: StatusCallbackEvent,
      ...emergencyParams,
    });
  }

  let shouldSendMessage;
  switch (componentUrl) {
    case 'twilio-voice-dialer':
      shouldSendMessage = false;
      break;
    case 'twilio-voice-basic-call-control':
    case 'twilio-voice-emergency':
      shouldSendMessage = statusCallbackEvents.includes(StatusCallbackEvent);
      break;
    case 'twilio-voice-monitoring':
      shouldSendMessage = true;
      break;
    default:
      shouldSendMessage = false;
  }

  if (shouldSendMessage) {
    const participants = await client
      .conferences(ConferenceSid)
      .participants.list();

    // Send the conference sid and the other participants' callSids to any client leg.
    // The sids will be used to update the participant resource such as putting it on hold.
    participants.forEach(async (currentParticipant) => {
      if (currentParticipant.label.split('-')[0] === 'client') {
        // When the StatusCallbackEvent is 'participant-leave', the req.body contains data
        // from the participant that left the conference. Send the callSid and data of the
        // participant that left the conference to all current client legs.
        if (StatusCallbackEvent === 'participant-leave') {
          await client
            .calls(currentParticipant.callSid)
            .userDefinedMessages
            .create({
              content: JSON.stringify({
                callSid: CallSid,
                category: 'conference-status',
                conferenceSid: ConferenceSid,
                hold: Hold,
                label: ParticipantLabel,
                muted: Muted,
                remove: true,
                statusCallbackEvent: StatusCallbackEvent,
              }),
            });
        } else {
          participants
            .filter((p) => p.callSid !== currentParticipant.callSid)
            .forEach(async (otherParticipant) => {
              await client
                .calls(currentParticipant.callSid)
                .userDefinedMessages
                .create({
                  content: JSON.stringify({
                    callSid: otherParticipant.callSid,
                    category: 'conference-status',
                    conferenceSid: ConferenceSid,
                    hold: otherParticipant.hold,
                    label: otherParticipant.label,
                    muted: otherParticipant.muted,
                    remove: false,
                    statusCallbackEvent: StatusCallbackEvent,
                  }),
                });
            });
        }
      }
    });
  }

  res.sendStatus(200);
};
