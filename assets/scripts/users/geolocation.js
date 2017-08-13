import { trackEvent } from '../app/event_tracking'
import store from '../store'
import { setGeolocationLoading, setGeolocationData } from '../store/actions/user'

const IP_GEOLOCATION_API_URL = 'https://freegeoip.net/json/'
const IP_GEOLOCATION_TIMEOUT = 1000 // After this time, we don’t wait any more

export function isGeolocationLoaded () {
  return store.getState().user.geolocation.loaded
}

/**
 * Forces loading state to be set to "true" without data - this represents
 * a timed-out or cancelled geolocation attempt
 */
export function setGeolocationLoaded () {
  store.dispatch(setGeolocationData(null))
  return Promise.resolve()
}

export function detectGeolocation () {
  // Reset state
  store.dispatch(setGeolocationLoading())

  // Fetch geolocation data; return Promise to caller
  // It resolves with either the result of the fetch or times out if it takes too long
  return Promise.race([ fetchGeolocation(), fetchGeolocationTimeout() ])
    .catch((error) => {
      console.warn('[detectGeolocation]', error)
    })
}

function fetchGeolocation () {
  return window.fetch(IP_GEOLOCATION_API_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(response.status)
      }

      return response.json()
    })
    .then(receiveGeolocation)
}

// Note: it's possible to receive this information late, after the time out,
// but we keep it anyway
function receiveGeolocation (info) {
  store.dispatch(setGeolocationData(info))

  return info
}

function fetchGeolocationTimeout () {
  return new Promise((resolve, reject) => {
    return window.setTimeout(() => {
      if (isGeolocationLoaded() === false) {
        setGeolocationLoaded()
        trackEvent('ERROR', 'ERROR_GEOLOCATION_TIMEOUT', null, null, false)
      }

      return reject(new Error('timed out.'))
    }, IP_GEOLOCATION_TIMEOUT)
  })
}