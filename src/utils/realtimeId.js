const MAX_SERVER_ID_LENGTH = 64;
const SERVER_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
export function isValidRealtimeId(id) {
    return (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= MAX_SERVER_ID_LENGTH &&
      SERVER_ID_PATTERN.test(id)
    );
  }
