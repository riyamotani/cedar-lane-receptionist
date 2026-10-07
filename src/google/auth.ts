import { google } from 'googleapis';
import { env } from '../config/env';

const auth = new google.auth.GoogleAuth({
  keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

export const calendar = google.calendar({ version: 'v3', auth });
export const sheets = google.sheets({ version: 'v4', auth });
