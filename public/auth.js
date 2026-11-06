const form = document.getElementById("authForm");
const message = document.getElementById("message");
const submitButton = form.querySelector("button");

function showMessage(text, type) {
    message.textContent = text;
    message.className = type;
}

function validEmail(email) {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const mode = form.getAttribute("data-mode");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const body = {
        email: email,
        password: password
    };

    if (!validEmail(email)) {
        showMessage("Enter a valid email address.", "error");
        return;
    }

    if (password.length < 8 || password.length > 64) {
        showMessage("Password must contain 8 to 64 characters.", "error");
        return;
    }

    if (mode === "signup") {
        const name = document.getElementById("name").value.trim();
        const confirmPassword = document.getElementById("confirmPassword").value;

        if (name.length < 2 || name.length > 80) {
            showMessage("Enter a name between 2 and 80 characters.", "error");
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.", "error");
            return;
        }

        body.name = name;
        body.confirmPassword = confirmPassword;
    }

    submitButton.disabled = true;

    try {
        showMessage(mode === "signup" ? "Creating your account..." : "Signing in...", "");

        const response = await fetch(mode === "signup" ? "/api/signup" : "/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify(body)
        });

        let result = {};

        try {
            result = await response.json();
        } catch (parseError) {
            showMessage("Unable to connect to the server.", "error");
            return;
        }

        if (!response.ok) {
            showMessage(result.message || "Request failed.", "error");
            return;
        }

        window.location.href = "/";
    } catch (error) {
        showMessage(error.message || "Unable to connect to the server.", "error");
    } finally {
        submitButton.disabled = false;
    }
});
