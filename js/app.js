/* =========================
   SIGN UP
========================= */

const signupForm = document.getElementById("signupForm");

if (signupForm) {

    signupForm.addEventListener("submit", function(event) {

        event.preventDefault();

        const name = document.getElementById("name").value;
        const phone = document.getElementById("phone").value;

        if (!name || !phone) {
            alert("Please enter your name and phone number.");
            return;
        }

        /*
         * Temporary storage.
         * Later we will replace this with Firebase Authentication.
         */

        localStorage.setItem("userName", name);
        localStorage.setItem("userPhone", phone);

        alert("Account created successfully!");

        window.location.href = "chats.html";

    });

}


/* =========================
   PASSWORD
========================= */

function togglePassword() {

    const password = document.getElementById("password");

    if (!password) return;

    if (password.type === "password") {
        password.type = "text";
    } else {
        password.type = "password";
    }

}


/* =========================
   OPEN CHAT
========================= */

function openChat(name) {

    localStorage.setItem("currentChat", name);

    window.location.href = "chat.html";

}


/* =========================
   GO BACK
========================= */

function goBack() {

    window.location.href = "chats.html";

}


/* =========================
   SEND MESSAGE
========================= */

function sendMessage() {

    const input = document.getElementById("messageInput");
    const messages = document.getElementById("messages");

    if (!input || !messages) return;

    const text = input.value.trim();

    if (text === "") return;


    const message = document.createElement("div");

    message.className = "message sent";

    message.innerHTML = `
        <p>${escapeHTML(text)}</p>
        <span>Now ✓✓</span>
    `;

    messages.appendChild(message);

    input.value = "";

    messages.scrollTop = messages.scrollHeight;

}


/* =========================
   ENTER TO SEND
========================= */

function handleEnter(event) {

    if (event.key === "Enter") {

        event.preventDefault();

        sendMessage();

    }

}


/* =========================
   SECURITY
========================= */

function escapeHTML(text) {

    const div = document.createElement("div");

    div.textContent = text;

    return div.innerHTML;

}


/* =========================
   SEARCH
========================= */

function searchChats() {

    const search = prompt("Search chats:");

    if (search) {
        alert("Searching for: " + search);
    }

}


/* =========================
   MENU
========================= */

function openMenu() {

    alert(
        "Menu\n\n" +
        "New group\n" +
        "Settings\n" +
        "Profile"
    );

}


/* =========================
   NEW CHAT
========================= */

function newChat() {

    alert("New chat screen coming next.");

}


/* =========================
   EMOJI
========================= */

function showEmoji() {

    const input = document.getElementById("messageInput");

    if (!input) return;

    input.value += "😊";

    input.focus();

}


/* =========================
   ATTACHMENT
========================= */

function attachFile() {

    alert("File attachment coming next.");

}


/* =========================
   CAMERA
========================= */

function openCamera() {

    alert("Camera coming next.");

}


/* =========================
   VOICE MESSAGE
========================= */

function sendVoiceMessage() {

    alert("Voice recording will be connected later.");

}


/* =========================
   VOICE CALL
========================= */

function startCall() {

    alert("Voice call feature coming next.");

}


/* =========================
   VIDEO CALL
========================= */

function startVideoCall() {

    alert("Video call feature coming next.");

}

function goTo(page) {
    window.location.href = page;
}

function searchContacts() {

    const search = prompt("Search contacts:");

    if (search) {
        alert("Searching contacts for: " + search);
    }

}
/* =========================
   PROFILE
========================= */

function changeProfilePhoto() {
    alert("Profile photo selection will be connected to Firebase Storage.");
}

function editProfileName() {

    const oldName =
        document.getElementById("displayName").textContent;

    const newName = prompt("Enter your name:", oldName);

    if (newName && newName.trim() !== "") {

        document.getElementById("displayName").textContent =
            newName;

        document.getElementById("profileName").textContent =
            newName;

        localStorage.setItem("userName", newName);
    }
}


function editAbout() {

    const oldAbout =
        document.getElementById("profileAbout").textContent;

    const about = prompt("Enter your About:", oldAbout);

    if (about && about.trim() !== "") {

        document.getElementById("profileAbout").textContent =
            about;

    }
}


/* =========================
   SETTINGS
========================= */

function openPrivacy() {
    alert("Privacy settings coming next.");
}

function openSecurity() {
    alert("Security settings coming next.");
}

function openChatSettings() {
    alert("Chat settings coming next.");
}

function openNotifications() {
    alert("Notification settings coming next.");
}

function openStorage() {
    alert("Storage and data settings coming next.");
}

function openHelp() {
    alert("Help center coming next.");
}

function toggleDarkMode() {

    document.body.classList.toggle("dark-mode");

    localStorage.setItem(
        "darkMode",
        document.body.classList.contains("dark-mode")
    );
}


function logout() {

    const confirmLogout =
        confirm("Are you sure you want to log out?");

    if (confirmLogout) {

        localStorage.clear();

        window.location.href = "signup.html";

    }
}


/* =========================
   NEW CONTACT
========================= */

function createContact() {

    const name = prompt("Enter contact name:");

    if (!name) return;

    const phone = prompt("Enter phone number:");

    if (!phone) return;

    alert(
        name +
        " has been added to your contacts."
    );

}


/* =========================
   NEW GROUP
========================= */

function chooseGroupPhoto() {

    alert("Group photo selection will be connected later.");

}


function createGroupNow() {

    const groupName =
        document.getElementById("groupName").value.trim();

    const selected =
        document.querySelectorAll(
            '.participant input[type="checkbox"]:checked'
        );

    if (!groupName) {

        alert("Please enter a group name.");

        return;

    }

    if (selected.length === 0) {

        alert("Select at least one participant.");

        return;

    }

    alert(
        "Group '" +
        groupName +
        "' created with " +
        selected.length +
        " participant(s)."
    );

}


function addParticipant() {

    alert("Add participant screen coming next.");

}


function leaveGroup() {

    const confirmLeave =
        confirm("Are you sure you want to exit this group?");

    if (confirmLeave) {

        alert("You have left the group.");

        window.location.href = "chats.html";

    }
}

function searchCalls() {

    const search = prompt("Search calls:");

    if (search) {
        alert("Searching calls for: " + search);
    }

}


function createGroup() {

    alert("Group creation screen coming next.");

}


function addStatus() {

    alert("Choose a photo or video to post as your status.");

}


function viewStatus(name) {

    alert("Opening " + name + "'s status.");

}
/* =========================
   LOGIN
========================= */

const loginForm = document.getElementById("loginForm");

if (loginForm) {

    loginForm.addEventListener("submit", function(event) {

        event.preventDefault();

        const phone =
            document.getElementById("loginPhone").value;

        const password =
            document.getElementById("loginPassword").value;

        if (!phone || !password) {

            alert("Please enter your phone number and password.");

            return;
        }

        /*
         * Temporary login.
         * Firebase Authentication will replace this later.
         */

        localStorage.setItem("loggedIn", "true");

        window.location.href = "chats.html";

    });

}


function toggleLoginPassword() {

    const password =
        document.getElementById("loginPassword");

    if (!password) return;

    if (password.type === "password") {

        password.type = "text";

    } else {

        password.type = "password";

    }

}


function forgotPassword() {

    const phone =
        prompt("Enter your phone number:");

    if (!phone) return;

    alert(
        "A password reset process will be sent to " +
        phone
    );

}


function googleLogin() {

    alert(
        "Google authentication will be connected with Firebase."
    );

}
/* =========================
   EDIT PROFILE
========================= */

function saveProfile() {

    const name =
        document.getElementById("editName").value.trim();

    const about =
        document.getElementById("editAbout").value.trim();

    if (!name) {

        alert("Please enter your name.");

        return;
    }

    localStorage.setItem("userName", name);
    localStorage.setItem("userAbout", about);

    alert("Profile updated successfully!");

    window.location.href = "profile.html";
}


/* Load About */

const savedAbout =
    localStorage.getItem("userAbout");

const editAboutInput =
    document.getElementById("editAbout");

if (editAboutInput && savedAbout) {

    editAboutInput.value = savedAbout;

}