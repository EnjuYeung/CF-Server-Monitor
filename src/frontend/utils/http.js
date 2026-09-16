import { getApiBases } from './config'
import { adminAccess } from './adminAccess.js'

const DEFAULT_ERROR_MESSAGES = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error'
}

const tokenKey = base => `jwt_token:${new URL(base || getApiBases()[0]).origin}`
export const getAuthToken = base => localStorage.getItem(tokenKey(base)) || ''
export const setAuthToken = (token, base) => localStorage.setItem(tokenKey(base), token)
export const clearAuthToken = base => localStorage.removeItem(tokenKey(base))

const redirectToAdminLogin = () => {
  if (typeof window === 'undefined') return

  const adminPath = adminAccess.path
  if (!adminPath) return
  if (window.location.pathname === adminPath || window.location.pathname.startsWith(`${adminPath}/`)) {
    window.location.reload()
    return
  }

  window.location.assign(adminPath)
}

const createHeaders = (includeAuth = true, baseUrl = null) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = includeAuth ? getAuthToken(baseUrl) : '';
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

const handleResponse = async (res, options = {}) => {
  const { autoRedirect = true, baseUrl = null } = options
  
  if (res.status === 401) {
    const hadToken = !!getAuthToken(baseUrl)
    clearAuthToken(baseUrl)
    adminAccess.authorized = false
    if (autoRedirect && hadToken) {
      redirectToAdminLogin()
    }
  }
  
  if (res.status === 403) {
    return { error: DEFAULT_ERROR_MESSAGES[403], status: 403 }
  }
  
  if (!res.ok) {
    let errorMessage = DEFAULT_ERROR_MESSAGES[res.status] || 'Request failed'
    let errorCode = res.status
    let errorMessageKey = null
    try {
      const data = await res.json()
      if (data.message) {
        errorMessageKey = data.message
      }
      if (data.error) {
        errorMessage = data.error
      }
      if (data.code) {
        errorCode = data.code
        if (!data.error && typeof data.code === 'string') {
          errorMessage = data.code
        }
      }
    } catch (e) {
      // ignore
    }
    return { error: errorMessage, code: errorCode, status: res.status, message: errorMessageKey }
  }
  
  try {
    const data = await res.json()
    return { data, status: res.status }
  } catch (e) {
    return { data: null, status: res.status }
  }
}

const request = async (method, url, body, options = {}) => {
  const { includeAuth = true, autoRedirect = true, baseUrl = null } = options
  const headers = createHeaders(includeAuth, baseUrl)
  const base = baseUrl || getApiBases()[0]

  try {
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      credentials: 'include'
    })
    return { ...(await handleResponse(res, { autoRedirect, baseUrl: base })), baseUrl: base }
  } catch (e) {
    return { error: e.message || 'Network error', status: 0, baseUrl: base }
  }
}

const fetchWithBase = async (baseUrl, url, options, method = 'GET', body = null) => {
  const { includeAuth = true, autoRedirect = true } = options
  const headers = createHeaders(includeAuth, baseUrl)

  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body,
    credentials: 'include'
  })

  const result = await handleResponse(res, { autoRedirect, baseUrl })
  return { ...result, baseUrl }
}

export const http = {
  get(url, options = {}) {
    return request('GET', url, null, options)
  },

  post(url, body = {}, options = {}) {
    return request('POST', url, body, options)
  },

  put(url, body = {}, options = {}) {
    return request('PUT', url, body, options)
  },

  delete(url, options = {}) {
    return request('DELETE', url, null, options)
  },

  async getAll(url, options = {}) {
    const bases = getApiBases()
    if (bases.length === 0) {
      const result = await this.get(url, options)
      return [{ ...result, baseUrl: getApiBases()[0] }]
    }

    const promises = bases.map(baseUrl =>
      fetchWithBase(baseUrl, url, options, 'GET', null)
    )

    const settled = await Promise.allSettled(promises)
    return settled.map((r, i) => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Request failed', status: 0, baseUrl: bases[i] })
  },

  async getAllWithProgress(url, onResult, options = {}) {
    const bases = getApiBases()
    if (bases.length === 0) {
      const result = await this.get(url, options)
      onResult({ ...result, baseUrl: getApiBases()[0] })
      return
    }

    const promises = bases.map(baseUrl =>
      fetchWithBase(baseUrl, url, options, 'GET', null)
        .then(result => {
          onResult({ ...result, baseUrl })
        })
        .catch(e => {
          const isCors = /failed to fetch|networkerror|cors/i.test(e.message)
          onResult({ error: e.message, status: 0, baseUrl, corsError: isCors })
        })
    )

    await Promise.allSettled(promises)
  },

  async postAll(url, body = {}, options = {}) {
    const bases = getApiBases()
    if (bases.length === 0) {
      const result = await this.post(url, body, options)
      return [{ ...result, baseUrl: getApiBases()[0] }]
    }

    const promises = bases.map(baseUrl =>
      fetchWithBase(baseUrl, url, options, 'POST', JSON.stringify(body))
    )

    const settled = await Promise.allSettled(promises)
    return settled.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Request failed', status: 0, baseUrl: '' })
  },

  getByIndex(url, index = 0, options = {}) {
    const bases = getApiBases()
    const base = (bases.length > 0 && bases[index] !== undefined) ? bases[index] : getApiBases()[0]
    return this.get(url, { ...options, baseUrl: base })
  },

  postByIndex(url, body = {}, index = 0, options = {}) {
    const bases = getApiBases()
    const base = (bases.length > 0 && bases[index] !== undefined) ? bases[index] : getApiBases()[0]
    return this.post(url, body, { ...options, baseUrl: base })
  }
}

export const isAdminLoggedIn = () => {
  return !!getAuthToken()
}

export default http
