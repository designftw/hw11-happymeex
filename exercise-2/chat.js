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
            if (this.atBottom) this.$nextTick(this.scrollToBottom);
        }, 5);
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

        // Initialize the collection of messages associated with the context
        const { objects: messagesRaw } = $gf.useObjects(context);
        return { channel, privateMessaging, messagesRaw };
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
            channelSearch: "",
            recipientUsername: "",
            invalidUsernameSearch: false,
            loadingSearch: false,
            requestedUsername: "",
            usernameInputClass: "hidden",
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
            lastMessage: "",
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
        };
    },

    computed: {
        messages() {
            let messages = this.messagesRaw
                // Filter the "raw" messages for data
                // that is appropriate for our application
                // https://www.w3.org/TR/activitystreams-vocabulary/#dfn-note
                .filter(
                    (m) =>
                        // Does the message have a type property?
                        m.type &&
                        // Is the value of that property 'Note'?
                        m.type == "Note" &&
                        // Does the message have a content property?
                        (m.content || m.attachment) &&
                        // Is that property a string?
                        typeof m.content == "string"
                );

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
                // Sort the messages with the
                // most recently created ones first
                .sort(
                    (m1, m2) => new Date(m2.published) - new Date(m1.published)
                )
                // Only show the 10 most recent ones
                //.slice(0, 10) // ask about the visible slicing nonsense in OH
                .reverse();
            this.lastMessage = messages[messages.length - 1]?.id;
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
            console.log(this.atBottom);
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
            let el;
            if (this.lastMessage) el = this.$refs[this.lastMessage][0];
            if (el) {
                el.scrollIntoView();
                this.changedChats = false;
            }
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
        toggleSettings() {
            this.settingsOpen = !this.settingsOpen;
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
            }, 1000);
        },
        async showUsernameTooltip(text) {
            this.usernameInputMessage = text;
            this.usernameInputClass = "tooltip-top";
            setTimeout(() => {
                this.usernameInputClass = "hidden";
            }, 1000);
        },

        async requestUsername() {
            console.log("requesting username", this.requestedUsername);
            if (this.requestedUsername === "") {
                this.showUsernameTooltip("Please enter a username.");
                return;
            }
            try {
                const status = await this.resolver.requestUsername(
                    this.requestedUsername
                );
                this.showUsernameTooltip("Success!");
            } catch {
                this.showUsernameTooltip("Username already taken!");
            }
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
            this.$gf.post(message);
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
            return (
                this.objects
                    // Filter the raw objects for profile data
                    // https://www.w3.org/TR/activitystreams-vocabulary/#dfn-profile
                    .filter(
                        (m) =>
                            // Does the message have a type property?
                            m.type &&
                            // Is the value of that property 'Profile'?
                            m.type == "Profile" &&
                            // Does the message have a name property?
                            m.name &&
                            // Is that property a string?
                            typeof m.name == "string"
                    )
                    // Choose the most recent one or null if none exists
                    .reduce(
                        (prev, curr) =>
                            !prev || curr.published > prev.published
                                ? curr
                                : prev,
                        null
                    )
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
    props: ["mid", "peekmode"],
    template: `#seen`,

    setup(props) {
        const $gf = Vue.inject("graffiti");
        const mid = Vue.toRef(props, "mid"); // messageId
        const peekMode = Vue.toRef(props, "peekmode");
        const { objects: messageData } = $gf.useObjects([mid]);
        return { messageData };
    },
    computed: {
        seen() {
            const viewers = new Set(); // for avoiding duplicates
            const ret = this.messageData.filter((obj) => {
                if (obj.type === "Read" && obj.object === this.mid) {
                    if (viewers.has(obj.actor)) return false;
                    viewers.add(obj.actor);
                    return true;
                }
                return false;
            });
            if (!this.peekMode && !viewers.has(this.$gf.me)) {
                console.log("posting seen by you");
                this.$gf.post({
                    type: "Read",
                    object: this.mid,
                    context: [this.mid],
                });
            }
            return ret;
        },
        seenTrimmed() {
            return this.seen.slice(0, 3);
        },
        needsEllipses() {
            return this.seen.length > 3;
        },
        mySeen() {
            // whether I've seen this message
            return this.seen.filter((obj) => obj.actor === this.$gf.me).at(0);
        },
    },
    methods: {
        temp() {
            //console.log(this.$gf.me);
            console.log(
                this.getName(
                    `graffitiactor://9bbd3d295a6d4040c40689d4eb849740a67a168eac6cb5e85dc004f6954942f2`
                )
            );
        },
        getName(actorId) {
            const names = this.$gf.useObjects([actorId]);
            console.log(names);
            return (
                names
                    // Filter the raw objects for profile data
                    // https://www.w3.org/TR/activitystreams-vocabulary/#dfn-profile
                    .filter(
                        (m) =>
                            // Does the message have a type property?
                            m.type &&
                            // Is the value of that property 'Profile'?
                            m.type == "Profile" &&
                            // Does the message have a name property?
                            m.name &&
                            // Is that property a string?
                            typeof m.name == "string"
                    )
                    // Choose the most recent one or null if none exists
                    .reduce(
                        (prev, curr) =>
                            !prev || curr.published > prev.published
                                ? curr
                                : prev,
                        null
                    )
            );
        },
    },
};

app.components = { Name, Like, Seen };
Vue.createApp(app).use(GraffitiPlugin(Vue)).mount("#app");
