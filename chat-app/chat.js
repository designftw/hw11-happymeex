import * as Vue from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { mixin } from "https://mavue.mavo.io/mavue.js";
import GraffitiPlugin from "https://graffiti.garden/graffiti-js/plugins/vue/plugin.js";
import Resolver from "./resolver.js";

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
    },

    setup() {
        // Initialize the name of the channel we're chatting in
        const channel = Vue.ref("secret-meex-2");

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
            selectedChat: 0,
            recentChats: [
                {
                    name: "secret-meex-2",
                    type: "channel",
                },
            ],
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
            },
            usernameConfirmed: false,
            //reminder management
            selectedReminders: new Set(),
            deletedReminders: new Set(), //need to manually track deleted reminder ids for rendering reasons
            allSelected: false,
            undoStack: [],
            reminderTooltip: false,
        };
    },

    computed: {
        reminderPopupHeader() {
            switch (this.reminderView) {
                case "home":
                    return "Reminders";
                case "new":
                    return "New Reminder";
            }
        },
        reminders() {
            const ret = this.remindersRaw.filter(
                (obj) =>
                    obj.type == "Reminder" && !this.deletedReminders.has(obj.id)
            );
            console.log("filtering for reminders", ret);
            return ret;
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

    methods: {
        temp() {
            console.log(this.reminders);
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
            } else {
                this.showReminderTooltip();
                this.usernameConfirmed = false;
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
        },
        openNewReminder() {
            this.reminderView = "new";
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
            console.log("posting reminder for", this.remindDate);
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
        async findChat() {
            this.invalidUsernameSearch = false;
            if (this.searchingPrivate) {
                for (const [i, chat] of this.recentChats.entries()) {
                    if (chat.username === this.usernameSearch) {
                        this.handleSidenav(chat, i);
                        return;
                    }
                }
                this.searchingChat = true;
                const recipientId = await this.resolver.usernameToActor(
                    this.usernameSearch
                );
                this.searchingChat = false;
                if (recipientId !== null) {
                    this.changedChats = true;
                    this.messagesLoading = true;
                    this.privateMessaging = true;
                    this.recipientUsername = this.usernameSearch;
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
                for (const [i, chat] of this.recentChats.entries()) {
                    if (chat.name === this.channelSearch) {
                        this.handleSidenav(chat, i);
                        return;
                    }
                }
                this.changedChats = true;
                this.privateMessaging = false;
                this.channel = this.channelSearch;
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
        setTimeout(this.postSeen, 1000);
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
