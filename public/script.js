
const form = document.getElementById("registrationForm");
const message = document.getElementById("message");
const eventSelect = document.getElementById("event");

function showMessage(text, type) {
message.textContent = text;
message.className = type;
}

function registerEvent(eventName) {
eventSelect.value = eventName;
document.getElementById("registration").scrollIntoView({
behavior: "smooth"
});
}

form.addEventListener("submit", async function (event) {
event.preventDefault();

const name = document.getElementById("name").value.trim();
const email = document.getElementById("email").value.trim();
const phone = document.getElementById("phone").value.trim();
const selectedEvent = eventSelect.value;

if (name.length < 2 || name.length > 80) {
showMessage("Name must contain 2 to 80 characters.", "error");
return;
}

if (email.length > 254) {
showMessage("Email address is too long.", "error");
return;
}

if (!/^[0-9]{10}$/.test(phone)) {
showMessage("Enter a valid 10-digit phone number.", "error");
return;
}

const allowedEvents = [
"Tech Fest 2026",
"Cultural Fest 2026",
"Web Development Workshop"
];

if (!allowedEvents.includes(selectedEvent)) {
showMessage("Please select a valid event.", "error");
return;
}

try {
showMessage("Submitting your registration...", "");

const response = await fetch("/api/register", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
name,
email,
phone,
event: selectedEvent
})
});

const result = await response.json();

if (!response.ok) {
throw new Error(result.message || "Registration failed.");
}

showMessage(result.message, "success");
form.reset();

} catch (error) {
showMessage(
error.message || "Unable to connect to the server.",
"error"
);
}
});
