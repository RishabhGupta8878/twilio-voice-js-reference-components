/**
 * Helpers for the Emergency Conference use case.
 *
 * Emergency location metadata travels from the softphone to the emergency
 * provider (PSAP) leg of the conference:
 *
 *   softphone: device.connect({ params: { To, Agent, emergency* } })
 *     -> TwiML webhook: the params arrive on the request body
 *     -> conference statusCallback: the params are appended to the callback URL
 *     -> emergency provider participant: the params are sent to the REST API
 *
 * The parameter names are the ones the Conference Participant resource accepts.
 * https://www.twilio.com/docs/voice/api/conference-participant-resource
 */

/** Emergency parameters accepted when creating a conference participant. */
const EMERGENCY_PARAMS = [
  'emergencyCallerPosition',
  'emergencyCallerLocation',
  'emergencyName',
  'emergencyAddress',
  'emergencyZipCode',
  'emergencyCity',
  'emergencyState',
  'emergencyCountry',
];

/** Numbers that route to an emergency provider. */
const EMERGENCY_NUMBERS = ['911', '933'];

/**
 * Read the emergency parameters out of an incoming Twilio webhook request.
 */
export const extractEmergencyParams = (req) =>
  EMERGENCY_PARAMS.reduce((params, name) => {
    const value = req.body?.[name] || req.query?.[name];
    if (value) {
      params[name] = value;
    }
    return params;
  }, {});

/**
 * True when the dialed number is an emergency number, such as 933 or +1911.
 * A country code is allowed, a number that merely contains 911/933 is not.
 */
export const isEmergencyNumber = (to = '') => {
  const digits = String(to).replace(/\D/g, '');
  return digits.length <= 5 && EMERGENCY_NUMBERS.some((number) => digits.endsWith(number));
};

/**
 * Append the emergency parameters to a statusCallback URL so that every
 * conference event carries the caller's location.
 */
export const appendEmergencyParams = (url, emergencyParams) => {
  Object.entries(emergencyParams).forEach(([name, value]) => {
    url.searchParams.append(name, value);
  });
  return url;
};
