// Where the game's server (multiplayer rooms, leaderboards, phone controller)
// lives. On the website it is the site itself. The PSG1 app runs the game from
// files inside the app, so it reaches play.latlas.lol directly, and only when
// the device is online: everything else works offline.
export const SERVER_HOST = __PSG1__ ? 'play.latlas.lol' : location.host;
const secure = __PSG1__ || location.protocol === 'https:';

/** WebSocket address of the relay, e.g. wsUrl('role=lobby'). */
export const wsUrl = (query) => `${secure ? 'wss' : 'ws'}://${SERVER_HOST}/ws?${query}`;

/** The game's public address (for room invites and the phone controller page). */
export const SITE = __PSG1__ ? 'https://play.latlas.lol/legoplane/' : new URL('./', location.href).href;

/** Is there a server to talk to at all? (Not in previews hosted elsewhere or from files.) */
export const SERVER_OK = __PSG1__ || (!/claude\.ai|claudeusercontent/.test(location.host) && location.protocol !== 'file:');
