const express = require('express');
const {Client} = require('pg');
const {google} = require('googleapis');
const {OAuth2} = google.auth;
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 4000;
const bodyParser = require('body-parser');

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URL
);

const client = new Client({
    host: "localhost",
    user: "postgres",
    port: 3000,
    password: process.env.DB_PASS,
    database: "iMapifyDB"
})

client.connect((err)=>{
    if(err){
        console.log('Error:', err);
    }
    console.log('Database connected');
});

client.on('notice', (msg) => console.warn('notice:', msg))

oauth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
        console.log("Refresh token received.");
        
        // Set the new tokens to the OAuth client
        oauth2Client.setCredentials(tokens);

        // Fetch user info
        const oauth2 = google.oauth2({
            auth: oauth2Client,
            version: 'v2'
        });

        oauth2.userinfo.get(async (err, userInfoResponse) => {
            if (err) {
                console.error('Failed to retrieve user info:', err);
                return;
            }

            const userEmail = userInfoResponse.data.email;
            console.log('Retrieved user email:', userEmail);

            // Store refresh token and email in database
            const queryText = 'INSERT INTO users (email, refresh_token) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET refresh_token = EXCLUDED.refresh_token';
            try {
                await client.query(queryText, [userEmail, tokens.refresh_token]);
                console.log("User email and refresh token stored successfully.");
            } catch (dbErr) {
                console.error('Database error:', dbErr.message);
            }
        });
    }
});

//===================================MIDDLEWARE=======================================

app.use(express.json());

app.use(bodyParser.urlencoded({ extended: true }));

const isAuthenticated = (req, res, next) => {
    const credentialsAreSet = oauth2Client.credentials && oauth2Client.credentials.access_token;
    if (!credentialsAreSet) {
        return res.status(401).send('You need to log in to access this page');
    }
    next();
};

//===================================ROUTING=======================================

app.get('/', (req, res) => {
    res.send('Welcome to iMapify');
});

app.get('/auth', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        promt: "consent",
        scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/userinfo.email',
        ]
    });
    res.redirect(url);
});

app.get('/home', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send("Authorization code is missing.");
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        if (!tokens.refresh_token) {
            // Fetch user info to get the email
            const oauth2 = google.oauth2({
                auth: oauth2Client,
                version: 'v2'
            });

            oauth2.userinfo.get(async (err, userInfoResponse) => {
                if (err) {
                    console.error('Failed to retrieve user info:', err);
                    return res.status(500).send('Failed to retrieve user information');
                }

                const userEmail = userInfoResponse.data.email;
                console.log('Retrieved user email:', userEmail);

                // Retrieve the refresh token from the database
                const queryText = 'SELECT refresh_token FROM users WHERE email = $1';
                const result = await client.query(queryText, [userEmail]);

                if (result.rows.length > 0) {
                    const refreshToken = result.rows[0].refresh_token;
                    oauth2Client.setCredentials({
                        access_token: tokens.access_token,
                        refresh_token: refreshToken,
                        scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar',
                        token_type: tokens.token_type,
                        expiry_date: tokens.expiry_date
                    });

                    console.log("Refresh token set from database.");
                } else {
                    console.log("No refresh token found in the database.");
                    return res.status(400).send("No refresh token available.");
                }

                res.redirect('/dashboard');
            });
        } else {
            // Refresh token is part of the tokens object, proceed directly
            res.redirect('/dashboard');
        }
    } catch (error) {
        console.error('Error during OAuth token exchange:', error);
        res.status(500).send('Authentication error');
    }
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    //Render dashboard
    res.send('Dashboard!')
});

//Returns events for next 24 hours
app.get('/get-events', isAuthenticated, async (req, res) => {
    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Get the current date-time in ISO format and add 24 hours for timeMax
        const now = new Date();
        const timeMin = now.toISOString(); // Current date-time in ISO format
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Current time + 24 hours
        const timeMax = tomorrow.toISOString();

        calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin, // Current time
            timeMax: timeMax, // 24 hours from now
            singleEvents: true,
            orderBy: 'startTime'
        }, (err, response) => {
            if (err) {
                console.error('The API returned an error: ' + err);
                return res.status(500).send('Error retrieving calendar events');
            }
            const events = response.data.items;
            if (events.length) {
                console.log('Upcoming events:', events);
                res.json(events); // Send events as JSON
            } else {
                console.log('No upcoming events found.');
                res.send('No upcoming events found.');
            }
        });
    } catch (error) {
        console.error('Error accessing Calendar API:', error);
        res.status(500).send('Failed to access Calendar API');
    }
});

app.post('/submit-address', isAuthenticated,async (req, res) => {
    const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: 'v2'
    });

    oauth2.userinfo.get(async (err, userInfoResponse) => {
        if (err) {
            console.error('Failed to retrieve user info:', err);
            return res.status(500).send('Failed to retrieve user information');
        }

        const userEmail = userInfoResponse.data.email;
        const { address1, address2, city, province, postalCode } = req.body;
        const fullAddress = `${address1} ${address2}, ${city}, ${province}, ${postalCode}`;

        try {
            // Update the address for the user identified by the email
            const query = 'UPDATE users SET address = $1 WHERE email = $2';
            const result = await client.query(query, [fullAddress, userEmail]);

            if (result.rowCount > 0) {
                res.send('Address updated successfully');
            } else {
                res.send('No user found or address not updated');
            }
        } catch (dbErr) {
            console.error('Database error:', dbErr);
            res.status(500).send('Failed to update address');
        }
    });
});


app.listen(PORT, err => {
    if(err) console.log(err)
    else {
          console.log(`Server listening on port: ${PORT} CNTL:-C to stop`)
          console.log(`To Test:`)
          console.log('http://localhost:4000/')
          console.log('http://localhost:4000/auth')
      }
})