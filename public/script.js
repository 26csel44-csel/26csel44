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
credentials: "same-origin",
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

const loginLink = document.getElementById("loginLink");
const signupLink = document.getElementById("signupLink");
const studentMenu = document.getElementById("studentMenu");
const studentName = document.getElementById("studentName");
const logoutButton = document.getElementById("logoutButton");
const accountNote = document.getElementById("accountNote");

function showSignedInStudent(student) {
    if (loginLink) {
        loginLink.hidden = true;
    }
    if (signupLink) {
        signupLink.hidden = true;
    }
    if (studentMenu) {
        studentMenu.hidden = false;
    }
    if (studentName) {
        studentName.textContent = student.name;
    }
    if (accountNote) {
        accountNote.hidden = false;
        accountNote.textContent = "Signed in as " + student.name + " (" + student.email + ").";
    }

    const nameInput = document.getElementById("name");
    const emailInput = document.getElementById("email");

    if (nameInput && !nameInput.value) {
        nameInput.value = student.name;
    }
    if (emailInput && !emailInput.value) {
        emailInput.value = student.email;
    }
}

async function loadStudent() {
    try {
        const response = await fetch("/api/me", {
            credentials: "same-origin"
        });

        if (!response.ok) {
            return;
        }

        const result = await response.json();

        if (!result.student) {
            return;
        }

        showSignedInStudent(result.student);
    } catch (error) {
        // The event page still works when the account service is unavailable.
    }
}

if (logoutButton) {
    logoutButton.addEventListener("click", async function () {
        try {
            const response = await fetch("/api/logout", {
                method: "POST",
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error("Could not log out.");
            }

            window.location.href = "/";
        } catch (error) {
            showMessage(error.message || "Could not log out.", "error");
        }
    });
}

if (loginLink) {
    loadStudent();
}
