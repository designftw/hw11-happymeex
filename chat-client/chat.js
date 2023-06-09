import * as Vue from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { mixin } from "https://mavue.mavo.io/mavue.js";
import GraffitiPlugin from "https://graffiti.garden/graffiti-js/plugins/vue/plugin.js";
import Resolver from "./resolver.js";

/**@param {string} time takes the form AA:BB, military-style*/
const getTime = (time) => {
    let hour = parseInt(time.slice(0, 2));
    const ampm = hour < 12 ? "AM" : "PM";
    if (hour === 0) hour = 12;
    return `${hour > 12 ? hour - 12 : hour}:${time.slice(3, 5)} ${ampm}`;
};

/**
 * @param {Date} date
 * @param {number} minutes
 * @returns the date obtained by adding `minutes` minutes to `date`
 */
const shiftedDate = (date, minutes) => {
    const ret = new Date(date.getTime() + 1000 * minutes * 60);
    return ret;
};

/**
 * Formats a date as an ISO string in the local time zone with no seconds
 *
 * @param {Date} date
 * @returns {string}
 */
const formatTime = (date) => {
    let time = date.toLocaleTimeString();
    if (time.indexOf(":") === 1) time = "0" + time;
    let ret = date.toISOString();
    return ret.slice(0, 11) + time.slice(0, 5);
};

/**
 * @returns the truncated ISO string corresponding to tomorrow
 */
const defaultDate = () => {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
};

const getRecentChats = () => {
    if (localStorage.recentChats !== undefined) {
        return JSON.parse(localStorage.recentChats);
    } else
        return [
            {
                name: "secret-meex",
                type: "channel",
            },
        ];
};

const getSelectedChat = () => {
    if (localStorage.selectedChat !== undefined) {
        return parseInt(localStorage.selectedChat);
    } else return 0;
};

const app = {
    // Import MaVue
    mixins: [mixin],

    // Import resolver
    async created() {
        this.resolver = new Resolver(this.$gf);
        while (this.username === null) {
            this.username = await this.resolver.actorToUsername(this.$gf.me);
        }
        console.log("Your username:", this.username);
        setInterval(() => {
            if (this.atBottom) {
                this.$nextTick(this.scrollToBottom);
            }
        }, 10);
        this.$refs.messageBarInput.focus();
        //console.log("from setup:", this.reminders);
        for (const reminder of this.reminders) {
            if (reminder.notify) this.scheduleReminder(reminder);
        }

        globalThis.addEventListener("beforeunload", () => {
            localStorage.recentChats = JSON.stringify(this.recentChats);
            localStorage.selectedChat = this.selectedChat.toString();
        });
    },

    setup() {
        // Initialize the name of the channel we're chatting in
        const channel = Vue.ref("secret-meex");

        // And a flag for whether or not we're private-messaging
        const privateMessaging = Vue.ref(false);

        // If we're private messaging use "me" as the channel,
        // otherwise use the channel value
        const $gf = Vue.inject("graffiti");
        const context = Vue.computed(() =>
            privateMessaging.value ? [$gf.me] : [channel.value]
        );
        const me = Vue.computed(() => [$gf.me]);

        // Initialize the collection of messages associated with the context
        const { objects: messagesRaw } = $gf.useObjects(context);
        const { objects: remindersRaw } = $gf.useObjects(me);
        return { channel, privateMessaging, messagesRaw, remindersRaw };
    },

    data() {
        // Initialize some more reactive variables
        return {
            username: null,
            settingsOpen: false,
            messageText: "",
            editID: "",
            editText: "",
            recipient: "", // this is an actor id
            searchingChat: false,
            usernameSearch: "",
            checkingUsername: false,
            channelSearch: "",
            recipientUsername: "",
            invalidUsernameSearch: false,
            loadingSearch: false,
            requestedUsername: "",
            usernameInputTooltip: false,
            usernameInputMessage: "",
            searchingPrivate: false,
            selectedChat: getSelectedChat(),
            recentChats: getRecentChats(),
            messagesLoading: true,
            atBottom: true, // whether user is scrolled to the bottom
            oldScrollTop: 0,
            changedChats: false,
            imageUri: null,
            file: null,
            loadingImage: false,
            downloadedImages: {},
            peekMode: false,
            lastSeen: "",
            replyingTo: undefined,
            replyingToContent: undefined,
            profilePicture: undefined,
            propicUri: undefined,
            messageCache: undefined,
            remindersOpen: false,
            reminderView: "home",
            //reminder specs
            title: "",
            description: "",
            notify: true,
            remindDate: "",
            chat: {
                type: undefined,
                name: "",
                recipientId: undefined,
            },
            usernameConfirmed: false,
            //reminder management
            viewUpcoming: true,
            selectedUpcomingReminders: new Set(),
            selectedPastReminders: new Set(),
            deletedReminders: new Set(), //need to manually track deleted reminder ids for rendering reasons
            allSelected: false,
            undoStackUpcoming: [],
            undoStackPast: [],
            reminderTooltip: false,
            reminderToEdit: undefined,
            // reminding
            reminderQueue: [],
            activeReminder: 0,
            snoozeTime: 5, //minutes to snooze
        };
    },

    computed: {
        selectedReminders() {
            return this.viewUpcoming
                ? this.selectedUpcomingReminders
                : this.selectedPastReminders;
        },
        undoStack() {
            return this.viewUpcoming
                ? this.undoStackUpcoming
                : this.undoStackPast;
        },
        currReminder() {
            return this.reminderQueue[this.activeReminder];
        },
        reminderPopupHeader() {
            switch (this.reminderView) {
                case "home":
                    return `${
                        this.viewUpcoming ? "Upcoming" : "Past"
                    } Reminders`;
                case "new":
                    return "New Reminder";
                case "edit":
                    return "Edit Reminder";
                case "reminder":
                    return `${this.reminderQueue.length} reminder notification${
                        this.reminderQueue.length > 1 ? "s" : ""
                    }`;
            }
        },
        reminders() {
            const ret = this.remindersRaw
                .filter(
                    (obj) =>
                        obj.type == "Reminder" &&
                        !this.deletedReminders.has(obj.id)
                )
                .sort(
                    (r1, r2) =>
                        new Date(r1.remindDate) - new Date(r2.remindDate)
                );
            console.log("filtering for reminders", ret);
            return ret;
        },
        upcomingReminders() {
            return this.reminders.filter((reminder) => {
                return new Date(reminder.remindDate) > new Date(Date.now());
            });
        },
        pastReminders() {
            return this.reminders.filter((reminder) => {
                return new Date(reminder.remindDate) < new Date(Date.now());
            });
        },
        remindersToDisplay() {
            return this.viewUpcoming
                ? this.upcomingReminders
                : this.pastReminders;
        },
        messages() {
            this.messageCache = new Map();
            let messages = this.messagesRaw.filter((m) => {
                if (
                    m.type &&
                    m.type == "Note" &&
                    (m.content || m.attachment) &&
                    typeof m.content == "string"
                ) {
                    this.messageCache.set(m.id, {
                        content: m.content,
                        actor: m.actor,
                    });
                    return true;
                }
                return false;
            });

            // Do some more filtering for private messaging
            if (this.privateMessaging) {
                messages = messages.filter(
                    (m) =>
                        // Is the message private?
                        m.bto &&
                        // Is the message to exactly one person?
                        m.bto.length == 1 &&
                        // Is the message to the recipient?
                        (m.bto[0] == this.recipient ||
                            // Or is the message from the recipient?
                            m.actor == this.recipient)
                );
            }

            messages = messages
                .sort(
                    (m1, m2) => new Date(m2.published) - new Date(m1.published)
                )
                .reverse();
            //this.lastMessage = messages[messages.length - 1]?.id;
            this.messagesLoading = false; // not sure that this even does anything
            return messages;
        },
    },

    methods: {
        temp() {
            getRecentChats();
            //console.log(localStorage.recentChats);
        },
        openCreateReminderFromChat() {
            this.chat = this.privateMessaging
                ? {
                      name: this.recipientUsername,
                      type: "private",
                      recipientId: this.recipient,
                  }
                : {
                      name: this.channel,
                      type: "channel",
                  };
            this.openNewReminder();
        },
        toggleViewingMode() {
            this.viewUpcoming = !this.viewUpcoming;
        },
        snoozeReminder(reminder, minutes) {
            reminder.remindDate = formatTime(
                shiftedDate(new Date(Date.now()), minutes)
            );
            console.log("snoozed to:", reminder.remindDate);
            this.dismissQueuedReminder();
            this.scheduleReminder(reminder, minutes * 60 * 1000);
        },
        dismissAll() {
            this.closeModal();
            this.reminderView = "home";
            this.reminderQueue = [];
            this.activeReminder = 0;
        },
        /** Removes reminder from queue but does not kill it */
        dismissQueuedReminder() {
            // remove current one by default
            this.reminderQueue.splice(this.activeReminder, 1);
            if (this.activeReminder >= this.reminderQueue.length) {
                this.activeReminder = Math.max(0, this.activeReminder - 1);
            }
            if (this.reminderQueue.length === 0) {
                this.closeModal();
                this.reminderView = "home";
            }
        },
        triggerReminder(reminder) {
            console.log("triggering reminder");
            if (
                this.reminders
                    .map((reminder) => reminder.id)
                    .includes(reminder.id)
            ) {
                this.reminderQueue.push(reminder);
                this.reminderView = "reminder";
                this.remindersOpen = true;
            }
        },
        scheduleReminder(reminder, time = undefined) {
            const date = new Date(reminder.remindDate);
            console.log("Scheduling reminder for", date);
            const delay =
                time === undefined ? date.getTime() - Date.now() : time;
            if (delay <= 0) {
                this.triggerReminder(reminder);
            } else {
                setTimeout(() => {
                    this.triggerReminder(reminder);
                }, delay);
            }
        },
        openChatFromReminder(chatData) {
            // chatData takes the same shape as chat data variable
            this.closeModal();
            console.log("reminder chat data:", chatData);
            this.findChat("dummy", chatData);
        },
        cancelNewOrEdit() {
            if (this.reminderView === "edit") {
                this.resetReminderInputs();
            }
            this.reminderView = "home";
        },
        handleReminderForm() {
            if (this.reminderView === "new") {
                this.postReminder();
            } else if (this.reminderView === "edit") {
                this.saveEditReminder();
            }
        },
        saveEditReminder() {
            console.log("saving edits!");
            const reminder = this.reminderToEdit;
            reminder.title = this.title;
            reminder.description = this.description;
            reminder.notify = this.notify;
            reminder.remindDate = this.remindDate;
            reminder.chat = {
                type: this.chat.type,
                name: this.chat.name,
                recipientId: this.chat.recipientId,
            };
            this.reminderToEdit = undefined;
            this.resetReminderInputs();
            this.reminderView = "home";
        },
        startEditReminder(reminder) {
            console.log("editing reminder now");
            this.title = reminder.title;
            this.description = reminder.description;
            this.notify = reminder.notify;
            this.remindDate = reminder.remindDate;
            this.chat = {
                type: reminder.chat?.type,
                name: reminder.chat?.name,
                recipientId: reminder.chat?.recipientId,
            };
            this.reminderToEdit = reminder;
            this.reminderView = "edit";
        },
        toDate(rawDate) {
            const date = new Date(rawDate).toString().split(" ");
            if (date[2].startsWith("0")) date[2] = date[2][1];
            return `${date[0]}, ${date[1]} ${date[2]}, ${getTime(
                date[4].slice(0, 5)
            )}`;
        },
        showReminderTooltip() {
            this.reminderTooltip = true;
            setTimeout(() => {
                this.reminderTooltip = false;
            }, 3000);
        },
        async confirmUsername() {
            this.searchingChat = true;
            const actor = await this.resolver.usernameToActor(this.chat.name);
            if (actor !== null) {
                this.usernameConfirmed = true;
                this.chat.recipientId = actor;
            } else {
                this.showReminderTooltip();
                this.usernameConfirmed = false;
                this.chat.recipientId = undefined;
            }
            this.searchingChat = false;
            return this.usernameConfirmed;
        },
        undo() {
            const undo = this.undoStack.pop();
            console.log("undos:", undo);
            for (const reminder of undo) {
                //this.deletedReminders.delete(reminder);
                this.$gf.post(this.copyReminder(reminder));
            }
        },
        copyReminder(reminder) {
            return {
                type: "Reminder",
                title: reminder.title,
                description: reminder.description,
                context: [this.$gf.me],
                remindDate: reminder.remindDate,
                notify: reminder.notify,
                chat: {
                    type: reminder.chat.type,
                    name: reminder.chat.name,
                },
            };
        },
        resetReminderInputs() {
            this.title = "";
            this.description = "";
            this.notify = true;
            this.remindDate = "";
            this.chat.name = "";
            this.chat.type = undefined;
            this.chat.recipientId = undefined;
        },
        openNewReminder() {
            this.reminderView = "new";
            this.remindersOpen = true;
            this.remindDate = formatTime(defaultDate());
            setTimeout(() => this.$refs.reminderTitle.focus(), 50);
        },
        toggleSelect(reminder) {
            if (this.selectedReminders.has(reminder)) {
                this.selectedReminders.delete(reminder);
                this.allSelected = false;
            } else {
                this.selectedReminders.add(reminder);
                this.allSelected =
                    this.selectedReminders.size === this.reminders.length;
            }
        },
        async postReminder() {
            if (this.chat.type === "private" && !this.usernameConfirmed) {
                const usernameConfirmed = await this.confirmUsername();
                if (!usernameConfirmed) return;
            }
            console.log("posting reminder for", new Date(this.remindDate));
            this.$gf.post({
                type: "Reminder",
                title: this.title,
                description: this.description,
                context: [this.$gf.me],
                remindDate: this.remindDate,
                notify: this.notify,
                chat: this.chat,
            });
            this.allSelected = false;
            this.reminderView = "home";
            this.resetReminderInputs();
        },
        deleteSelected() {
            this.deleteReminder(...this.selectedReminders);
            this.selectedReminders = new Set();
            this.allSelected = false;
            this.reminders;
        },
        selectAll() {
            if (this.allSelected) {
                this.selectedReminders = new Set();
            } else {
                for (const reminder of this.reminders) {
                    this.selectedReminders.add(reminder);
                }
            }
            this.allSelected = !this.allSelected;
        },
        deleteReminder(...reminders) {
            for (const reminder of reminders)
                this.deletedReminders.add(reminder.id);
            this.undoStack.push(reminders);
            this.$gf.remove(...reminders);
        },
        startReply(actorId, content, messageId) {
            this.replyingTo = {
                actor: actorId,
                message: messageId,
            };
            this.replyingToContent = content;
            this.$refs.messageBarInput.focus();
        },
        exitReply() {
            this.replyingTo = undefined;
        },
        async onPropicUpload(e) {
            const file = e.target.files[0];
            console.log("uploading profile picture");
            const propicUri = await this.$gf.media.store(file);
            console.log(propicUri);
            this.$gf.post({
                type: "Profile",
                context: [this.$gf.me],
                image: {
                    type: "Image",
                    magnet: propicUri,
                },
            });
        },
        async uploadImage(isNew) {
            console.log("uploading image...");
            if (this.imageUri && !isNew) return;
            this.$refs.sendButton.value = "Loading image...";
            this.loadingImage = true;
            this.imageUri = await this.$gf.media.store(this.file);
            this.loadingImage = false;
            this.$refs.sendButton.value = "Send";
            console.log("got image uri:", this.imageUri);
            return true;
        },
        onImageAttachment(e) {
            const file = e.target.files[0];
            this.file = file;
            this.uploadImage(true);
            console.log("uploaded file:", file.name);
        },
        onScroll(e) {
            if (
                e.target.scrollTop + e.target.clientHeight >=
                e.target.scrollHeight
            ) {
                this.atBottom = true;
            }
            if (e.target.scrollTop < this.oldScrollTop && !this.changedChats) {
                console.log("no longer at bottom");
                this.atBottom = false;
            }
            this.oldScrollTop = e.target.scrollTop;
        },
        scrollToBottom() {
            if (!this.$refs.messageWrapper?.lastElementChild) return;
            this.$refs.messageWrapper.lastElementChild.scrollIntoView({
                block: "nearest",
            });
            this.changedChats = false;
        },
        handleSidenav(chat, i) {
            if (i !== this.selectedChat) {
                this.messagesLoading = true;
                this.changedChats = true;
            }
            if (chat.type === "channel") {
                this.channel = chat.name;
                this.privateMessaging = false;
            } else if (chat.type === "private") {
                this.recipientUsername = chat.username;
                this.privateMessaging = true;
                this.recipient = chat.recipientId;
            }
            this.selectedChat = i;
            this.atBottom = true;
            this.$refs.messageBarInput.focus();
        },
        exitEdit() {
            this.editID = "";
        },
        closeModal() {
            this.settingsOpen = false;
            this.remindersOpen = false;
        },
        /**@param {{type: string, name: string, recipientId: string} | undefined} reminderParams */
        async findChat(...params) {
            const reminderParams = params[1];
            this.invalidUsernameSearch = false;
            const searchingPrivate = reminderParams
                ? reminderParams.type === "private"
                : this.searchingPrivate;
            if (searchingPrivate) {
                const username = reminderParams
                    ? reminderParams.name
                    : this.usernameSearch;
                for (const [i, chat] of this.recentChats.entries()) {
                    if (chat.username === username) {
                        this.handleSidenav(chat, i);
                        return;
                    }
                }
                this.searchingChat = true;
                const recipientId = reminderParams
                    ? reminderParams.recipientId
                    : await this.resolver.usernameToActor(this.usernameSearch);
                this.searchingChat = false;
                if (recipientId !== null) {
                    this.changedChats = true;
                    this.messagesLoading = true;
                    this.privateMessaging = true;
                    this.recipientUsername = username;
                    this.recipient = recipientId;
                    this.recentChats.unshift({
                        username: this.recipientUsername,
                        recipientId: recipientId,
                        type: "private",
                    });
                    this.atBottom = true;
                    this.selectedChat = 0;
                    this.usernameSearch = "";
                    this.$refs.messageBarInput.focus();
                } else {
                    this.showUserSearchTooltip();
                    setTimeout(() => {
                        this.$refs.usersearch.focus();
                    }, 150);
                }
            } else {
                const channel = reminderParams
                    ? reminderParams.name
                    : this.channelSearch;
                console.log("channel:", channel);
                for (const [i, chat] of this.recentChats.entries()) {
                    if (chat.name === channel) {
                        this.handleSidenav(chat, i);
                        return;
                    }
                }
                this.changedChats = true;
                this.privateMessaging = false;
                this.channel = channel;
                this.recentChats.unshift({
                    name: this.channel,
                    type: "channel",
                });
                this.selectedChat = 0;
                this.channelSearch = "";
                this.atBottom = true;
                this.$refs.messageBarInput.focus();
            }
        },
        async showUserSearchTooltip() {
            this.invalidUsernameSearch = true;
            setTimeout(() => {
                this.invalidUsernameSearch = false;
            }, 3000);
        },
        async showUsernameTooltip(text) {
            this.usernameInputMessage = text;
            this.usernameInputTooltip = true;
            setTimeout(() => {
                this.usernameInputTooltip = false;
            }, 3000);
        },

        async requestUsername() {
            if (this.requestedUsername === "") {
                this.showUsernameTooltip("Please enter a username.");
                setTimeout(() => {
                    this.$refs.usernameRequest.focus();
                }, 150);
                return;
            }
            try {
                this.checkingUsername = true;
                const name = this.requestedUsername;
                const status = await this.resolver.requestUsername(
                    this.requestedUsername
                );
                this.checkingUsername = false;
                this.username = name;
                this.showUsernameTooltip("Success!");
            } catch {
                this.showUsernameTooltip("Username already taken!");
                this.checkingUsername = false;
                setTimeout(() => {
                    this.$refs.usernameRequest.focus();
                }, 150);
            }
        },

        async sendMessage() {
            const message = {
                type: "Note",
                content: this.messageText,
            };

            if (this.file) {
                await this.uploadImage(false);
                console.log("done awaiting image uri");
                message.attachment = {
                    type: "Image",
                    magnet: this.imageUri,
                };
            }

            if (this.replyingTo) {
                message.inReplyTo = this.replyingTo.message; // message id
            }

            // The context field declares which
            // channel(s) the object is posted in
            // You can post in more than one if you want!
            // The bto field makes messages private
            if (this.privateMessaging) {
                message.bto = [this.recipient];
                message.context = [this.$gf.me, this.recipient];
            } else {
                message.context = [this.channel];
            }

            // Send!
            const msg = this.$gf.post(message);
            console.log(msg);
            this.messageText = "";
            this.atBottom = true;
            this.file = null;
            this.imageUri = null;
            this.$refs.fileInput.value = null;
        },

        removeMessage(message) {
            this.$gf.remove(message);
        },

        startEditMessage(message) {
            // Mark which message we're editing
            this.editID = message.id;
            // And copy over it's existing text
            this.editText = message.content;
        },

        saveEditMessage(message) {
            // Save the text (which will automatically
            // sync with the server)
            message.content = this.editText;
            // And clear the edit mark
            this.editID = "";
        },
    },
    watch: {
        messages(messages) {
            const withImages = messages.filter((msg) => {
                return (
                    msg.attachment &&
                    msg.attachment.type === "Image" &&
                    msg.attachment.magnet
                );
            });
            //console.log(withImages.length, "messages with images");
            withImages.forEach(async (msg) => {
                const uri = msg.attachment.magnet;
                if (!this.downloadedImages[uri]) {
                    //console.log("undownloaded image");
                    //const blob = await this.$gf.media.fetch(uri);
                    //this.downloadedImages[uri] = URL.createObjectURL(blob);
                    this.downloadedImages[uri] = true;
                } else {
                    //console.log("already seen");
                }
            });
        },
    },
};

const Name = {
    props: ["actor", "editable"],

    setup(props) {
        // Get a collection of all objects associated with the actor
        const { actor } = Vue.toRefs(props);
        const $gf = Vue.inject("graffiti");
        return $gf.useObjects([actor]);
    },

    computed: {
        profile() {
            return this.objects
                .filter(
                    (m) =>
                        m.type &&
                        m.type == "Profile" &&
                        m.name &&
                        typeof m.name == "string"
                )
                .reduce(
                    (prev, curr) =>
                        !prev || curr.published > prev.published ? curr : prev,
                    null
                );
        },
    },

    data() {
        return {
            editing: false,
            editText: "",
        };
    },

    methods: {
        editName() {
            this.editing = true;
            // If we already have a profile,
            // initialize the edit text to our existing name
            this.editText = this.profile ? this.profile.name : this.editText;
        },

        saveName() {
            if (this.profile) {
                // If we already have a profile, just change the name
                // (this will sync automatically)
                this.profile.name = this.editText;
            } else {
                // Otherwise create a profile
                this.$gf.post({
                    type: "Profile",
                    name: this.editText,
                });
            }

            // Exit the editing state
            this.editing = false;
        },

        exitSave() {
            this.editing = false;
        },
    },

    template: "#name",
};

const Like = {
    props: ["mid"],
    template: "#like",

    setup(props) {
        const $gf = Vue.inject("graffiti");
        const mid = Vue.toRef(props, "mid");
        const { objects: messageData } = $gf.useObjects([mid]);
        return { messageData };
    },

    computed: {
        likes() {
            return this.messageData.filter((obj) => {
                return obj.type === "Like" && obj.object === this.mid;
            });
        },
        myLike() {
            // whether *I* like this message
            return this.likes
                .filter((likeObj) => likeObj.actor === this.$gf.me)
                .at(0);
        },
    },

    methods: {
        sendLike() {
            console.log(this.messageData);
            const obj = {
                type: "Like",
                object: this.mid,
                context: [this.mid],
            };
            const myLike = this.myLike;
            if (myLike) {
                this.$gf.remove(myLike); // figure this out
                console.log("removed like");
            } else {
                this.$gf.post(obj);
                console.log("liked message:", this.mid);
            }
        },
    },
};

const Seen = {
    components: { Name },
    props: ["mid", "peekmode"],
    template: `#seen`,

    setup(props) {
        const $gf = Vue.inject("graffiti");
        const mid = Vue.toRef(props, "mid"); // messageId
        const peekmode = Vue.toRef(props, "peekmode");
        const { objects: messageData } = $gf.useObjects([mid]);
        return { messageData, peekmode, mid };
    },
    mounted() {
        setTimeout(this.postSeen, 1500);
    },
    watch: {
        peekmode(val, oldVal) {
            this.postSeen();
        },
    },
    methods: {
        postSeen() {
            console.log("considering posting...");
            if (!this.peekmode && !this.viewers.has(this.$gf.me)) {
                console.log("posting seen by", this.$gf.me);
                this.$gf.post({
                    type: "Read",
                    object: this.mid,
                    context: [this.mid],
                });
            }
        },
    },
    computed: {
        viewers() {
            return this.processSeen.viewers;
        },
        seen() {
            return this.processSeen.seen;
        },
        processSeen() {
            const viewers = new Set(); // for avoiding duplicates
            const ret = this.messageData.filter((obj) => {
                if (obj.type === "Read" && obj.object === this.mid) {
                    if (viewers.has(obj.actor)) return false;
                    viewers.add(obj.actor);
                    return true;
                }
                return false;
            });
            return { viewers, seen: ret };
        },
        seenTrimmed() {
            return this.seen.slice(0, 3);
        },
        needsEllipses() {
            return this.seen.length > 3;
        },
    },
};

const Propic = {
    props: ["actor"],
    template: `#propic`,
    setup(props) {
        const $gf = Vue.inject("graffiti");
        const actor = Vue.toRef(props, "actor");
        return $gf.useObjects([actor]);
    },
    data() {
        return {
            url: "assets/default.jpeg",
        };
    },
    methods: {
        async setURL(magnet) {
            const blob = await this.$gf.media.fetch(magnet);
            this.url = URL.createObjectURL(blob);
        },
    },
    computed: {
        fetchUrl() {
            // profile
            const mostRecent = this.objects
                .filter(
                    (m) =>
                        m.type &&
                        m.type == "Profile" &&
                        ((m.image && m.image.magnet) ||
                            (m.icon && m.icon.magnet))
                )
                .reduce(
                    (prev, curr) =>
                        !prev || curr.published > prev.published ? curr : prev,
                    null
                );
            if (mostRecent) {
                if (mostRecent.image) this.setURL(mostRecent.image.magnet);
                else if (mostRecent.icon) this.setURL(mostRecent.icon.magnet);
            }
            return null;
        },
    },
};

app.components = { Name, Like, Seen, Propic };
Vue.createApp(app).use(GraffitiPlugin(Vue)).mount("#app");
