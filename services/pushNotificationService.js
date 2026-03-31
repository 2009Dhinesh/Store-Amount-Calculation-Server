const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
let expo = new Expo();

/**
 * Send a push notification to specific users
 * @param {Array} pushTokens - Array of Expo push tokens
 * @param {Object} message - Notification content { title, body, data }
 */
const sendPushNotifications = async (pushTokens, message) => {
  let messages = [];
  
  for (let pushToken of pushTokens) {
    // Check that all your push tokens appear to be valid Expo push tokens
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      continue;
    }

    // Construct a message
    messages.push({
      to: pushToken,
      sound: 'default',
      title: message.title,
      body: message.body,
      data: message.data || {},
      priority: 'high',
      channelId: 'default',
    });
  }

  // The Expo push notification service accepts batches of notifications
  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];

  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Push ticket chunk:', ticketChunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending push notification chunk:', error);
    }
  }

  // Note: In a production app, you should also handle receipt errors
  // by calling expo.getPushNotificationReceiptsAsync() later.
  return tickets;
};

module.exports = { sendPushNotifications };
