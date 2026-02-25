# Bot Command Workflows — Step-by-Step Guides
This document describes the common tasks users ask about and what information
the bot needs to guide them to the right command.

---

## Uploading a Resource / File

**Command:** `/resource upload`

**Questions to ask:**
1. What type of file is it? (PDF, DOCX, slides, etc.) — for context only, bot accepts any file
2. Is this an official school resource or something a student is sharing? → `type:official` or `type:student-resource`
3. Is it for a specific course? (e.g. Anatomy, Physiology, Biochemistry) → `course:<name>`
4. Is it for a specific cohort (class year) or for everyone? → `cohort:<name>` or leave blank
5. Should other students be able to download it? → `shareable:true` or `shareable:false`

**Final command format:**
```
/resource upload file:<attach your file> type:official course:anatomy cohort:2027
```

**Example walkthrough:**
- User: "I want to upload the anatomy syllabus for the Class of 2027"
- Bot asks: Is this an official document or a student resource?
- User: "Official"
- Bot: "Got it. Here's the command: `/resource upload file:<attach PDF> type:official course:anatomy cohort:2027`"

---

## Tagging a Resource for a Course

When uploading, use the `course` option. The course name must match an existing course slug.
To see available courses: `/course list`

If the course doesn't exist yet, an admin needs to run: `/course add name:anatomy label:"Gross Anatomy"`

---

## Reserving a Room / Space

**No bot command** — room booking is done through the Astra scheduling system.

**Questions to ask:**
1. What date and time do you need the room?
2. How many people are attending?
3. Do you need AV / video conferencing?
4. Do you need any special setup (tables arranged, whiteboard, etc.)?

**Steps to give the user:**
1. Check availability: go to https://www.aaiscloud.com/UArizona_UAHS/Default.aspx → Calendar → Scheduling Grids
2. Submit request: in Astra, go to Events → Request event
3. For special needs (parking passes, room setup, AV): email Scott Reikofski at reikofski@email.arizona.edu / 602-827-2796
4. Submit at least **7 days before** the event (2 weeks recommended)

---

## Requesting Funding for an Org Event

**No bot command** — funding is requested through Google Forms.

**Questions to ask:**
1. What type of event? (lunch talk, simulation event, speaker, workshop)
2. How many attendees are expected?
3. Do you need food? Which vendor?
4. What is the estimated total cost?
5. What is the event date?

**Key rules to confirm:**
- Must submit funding request **at least 14 days before** the event
- Event must be educational and open to all students/staff/faculty
- Lunch talk cap: $15/person up to $150 max
- Sim event cap: $150
- One lunch talk and one sim event per group maximum

**Steps:**
1. Submit Funding Request Form: https://docs.google.com/forms/d/e/1FAIpQLSd1RIMrrDfoOVrQZxwIhFApmHLJgwCRLMriJ-f7JNjNDUcnyA/viewform
2. Book a room via Astra (see room reservation workflow above)
3. For food: email Baylee Duffy at bayleeduffy@arizona.edu with order details (3+ business days notice)
4. Contact MSG Treasurer Alex Eischeid at finance@uacomps.org with questions

---

## Adding an Event to the Calendar

**Command:** `/calendar add`

**Questions to ask:**
1. What is the event title?
2. What date and time? (format: YYYY-MM-DD or YYYY-MM-DDTHH:MM)
3. Who is this event for?
   - Everyone → `scope:university`
   - A specific class year → `scope:cohort`
   - A small group (CBI, anatomy lab, etc.) → `scope:group group:<name>`
4. Where is it? (optional location)
5. Is there a description to include?
6. Does it last all day?

**Final command format:**
```
/calendar add title:"Anatomy Lab" start:2026-03-15T09:00 scope:group group:anatomy-a location:"Sim Center Room 2"
```

---

## Submitting an Event to the IG Calendar (Public Website)

This is separate from the Discord calendar — it puts the event on the uacomps.org website.

**Steps:**
1. Fill out the IG Events Calendar Form: https://docs.google.com/forms/d/e/1FAIpQLSdZGN5ABFnciXKJizrWwdS_phNOPiU7dVOi2gk9K4BKEyyh2Q/viewform
2. After submitting, scroll up to verify the submission was recorded

---

## Planning a Simulation Center Event

**No bot command** — requires direct coordination with the Sim Center.

**Questions to ask:**
1. What type of simulation activity?
2. How many students will attend?
3. Do you have a faculty advisor identified?
4. Do you have three preferred date/time options?

**Key rules:**
- Submit reservation request **at least 6 weeks before** the event
- Faculty advisor must approve facilitator and activity details before submission
- Facilitator ratio: 1:10 (one facilitator per 10 students)
- Equipment is free; consumables (needles, gauze) are invoiced
- Operating hours: 8am–5pm Mon–Fri; evenings/Saturdays end by 8pm max 3 hours

**Steps:**
1. Email Sim Center: tannerwhiting@email.arizona.edu with three date options, facilitator count, event description
2. Wait for CSI review (up to 2 weeks)
3. Complete Student Interest Group Simulation Event form
4. Schedule planning meeting with CSI staff within 3 weeks of approval
5. Await cost estimate and final approval

---

## Finding a Person's Contact Info

**Command:** `/people search query:<name>`

Then use `/people info person:<name>` for full details including email, phone, groups, and cohort.

---

## Sending an Announcement to a Group or Cohort

**Command:** `/announce send`

**Questions to ask:**
1. Who should receive it?
   - Everyone → `scope:university channel:#channel`
   - A specific class year → `scope:university` or `scope:cohort channel:#channel`
   - A small group → `scope:group group:<name>` (sends as DM to each member)
2. What is the message?
3. Should it be formatted as an embed (default) or plain text?

---

## Asking Questions About School Documents

**Command:** `/ask question:<your question>`

Or just @mention the bot with your question — it will search the knowledge base automatically.

Works for questions like:
- "What are the requirements for MSG event funding?"
- "Who is the MSG treasurer?"
- "How do I schedule a tutoring appointment?"
- "What is CHIP?"
