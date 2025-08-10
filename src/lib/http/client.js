/**
 * @file http-client.js
 * Shared HTTP client utilities for making API requests
 */

const axios = require('axios');

// Standard HTTP client configuration
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

/**
 * Makes a POST request with standardized error handling
 * @param {string} url - The URL to post to
 * @param {object} data - The data to send (can be null)
 * @param {object} options - Additional options
 * @param {object} options.headers - Additional headers
 * @param {number} options.timeout - Request timeout in ms
 * @param {Array<number>} options.successStatuses - Additional status codes to treat as success
 * @returns {Promise<object>} The response data
 */
async function postRequest(url, data, options = {}) {
  const {
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    successStatuses = [],
  } = options;

  try {
    const axiosConfig = {
      method: 'POST',
      url,
      headers: {
        ...DEFAULT_HEADERS,
        ...headers,
      },
      timeout,
    };

    // Include data payload when provided
    if (data !== null) {
      axiosConfig.data = data;
    }

    const response = await axios(axiosConfig);

    // Check for additional success statuses
    // some FACEIT API endpoints e.g. return 500 even when successful,
    // thus needed
    if (successStatuses.includes(response.status)) {
      return { success: true, status: response.status, data: response.data };
    }

    return response.data;
  } catch (error) {
    // Check for additional success statuses in error responses
    if (error.response && successStatuses.includes(error.response.status)) {
      return { success: true, status: error.response.status };
    }

    const errorMessage = error.response
      ? `${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message;

    throw new Error(`POST request to ${url} failed: ${errorMessage}`);
  }
}

/**
 * Makes a GET request with standardized error handling
 * @param {string} url - The URL to get from
 * @param {object} options - Additional options
 * @param {object} options.headers - Additional headers
 * @param {number} options.timeout - Request timeout in ms
 * @returns {Promise<object>} The response data
 */
async function getRequest(url, options = {}) {
  const { headers = {}, timeout = DEFAULT_TIMEOUT } = options;

  try {
    const response = await axios.get(url, {
      headers: {
        ...DEFAULT_HEADERS,
        ...headers,
      },
      timeout,
    });

    return response.data;
  } catch (error) {
    const errorMessage = error.response
      ? `${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message;

    throw new Error(`GET request to ${url} failed: ${errorMessage}`);
  }
}

/**
 * Standardized error handler for Express API endpoints
 * @param {object} res - The Express response object
 * @param {Error} error - The error object
 * @param {string} context - Optional context for the error
 */
function handleApiError(res, error, context = '') {
  const errorMessage = context ? `${context}: ${error.message}` : error.message;
  console.error('API Error:', errorMessage);
  res.status(500).json({ error: 'Internal Server Error' });
}

// Creates specialized request functions for specific API patterns
const createApiClient = {
  // Message deletion via API
  messageRetraction: () => ({
    deleteMessage(url, data, headers = {}) {
      return postRequest(url, data, {
        headers,
        successStatuses: [200, 201, 202, 204, 500], // 500 is success for message deletion
      });
    },
  }),

  // Discord Webhook
  discordWebhook: () => ({
    sendNotification(url, payload) {
      return postRequest(url, payload, {
        timeout: DEFAULT_TIMEOUT,
      });
    },
  }),
};

module.exports = {
  postRequest,
  getRequest,
  handleApiError,
  createApiClient,
};
