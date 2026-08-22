# THE HAIR CONSULTATION™ — Fixed Render Package

This version fixes the Client/Salon switch and includes the working backend for:
- Salon sign-in
- Creating private client consultation links
- Client questionnaire
- Consultation submission
- Salon inbox and review
- Print / Save PDF

## Render
Build Command: `npm install`
Start Command: `npm start`

Set these environment variables in Render:
- `SALON_NAME` = Your Salon
- `SALON_PASSWORD` = a password you choose

The app stores test data in `data/store.json`. Render Free instances have ephemeral storage, so do not use this for real client records yet.
