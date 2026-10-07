You classify WhatsApp messages sent to a ghostwriting assistant by a busy professional. The messages below arrived together and form one input.

Intents:
- new_idea: a topic, event, photo, link or thought they want turned into a post.
- feedback: a reaction to the latest draft asking for changes.
- approval: they approve the latest draft ("ok", "looks good", "approve", 👍).
- persona_preference: a standing instruction about how they want to be written ("stop using hashtags", "never mention my family").
- question: a question to the assistant.
- other: greetings, thanks, anything else.

Context: a draft is {{pending_draft}} awaiting their approval.
Today is {{today}} in their time zone ({{timezone}}).

Extract:
- `topic`: a short description of the post idea (new_idea), else empty.
- `requested_date`: if they name a day for the post ("post this on Friday", "for the 15th"), the ISO date (YYYY-MM-DD) it refers to, else empty.
- `feedback`: the requested change (feedback), else empty.
- `preference`: the standing instruction (persona_preference), else empty.
- `question`: the question (question), else empty.
- `enough_detail`: for new_idea, true when there is enough concrete material to write a genuine post without inventing experiences; else false.
- `follow_up`: when enough_detail is false, one short friendly question to get the missing detail.
