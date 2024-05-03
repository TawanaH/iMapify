/*
-Need to get location from browser, then we can start cooking
-Need to handle user auth, so whenever the user signs in we can load their refresh key
-When a user signs in, add their username to there req header 
*/

const express = require('express');
const {Client} = require('pg');
const {google} = require('googleapis');
const {OAuth2} = google.auth;
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 4000;
const username = "TawanaH"

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

client.connect(()=>{
    console.log('client has connected')
});

client.on('notice', (msg) => console.warn('notice:', msg))

oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
        console.log("Refresh token received.");
        const queryText = 'UPDATE users SET refresh_token = $1 WHERE username = $2';
        client.query(queryText, [tokens.refresh_token, username], (err, res) => {
            if(err){
                console.log(err.message);
            }
            console.log("Refresh token stored successfully.");
        })
    }
    console.log("Access token received", tokens.access_token);
  });











//===================================ROUTING=======================================

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.get('/auth', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token)
        promt: "consent",
        scope: 'https://www.googleapis.com/auth/calendar'
    });
    res.redirect(url);
});

app.get('/home', async (req, res) => {
    const code = req.query.code;
    const {tokens} = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)
    res.send('Complete!')
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