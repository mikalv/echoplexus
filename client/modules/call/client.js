define(['modules/call/rtc',
        'text!modules/call/templates/callPanel.html'
        ], function (RTCMultiConnection, callPanelTemplate) {
    return Backbone.View.extend({
        className: 'callClient',
        template: _.template(callPanelTemplate),

        events: {
            "click .join": "joinCall",
            "click .create": "createCall",
            "click .hang-up": "leaveCall",
            "click .mute-audio": "toggleMuteAudio",
            "click .mute-video": "toggleMuteVideo"
        },

        initialize: function (opts) {
            var self = this;
            _.bindAll(this);
            this.channel = opts.channel;
            this.channelName = opts.room;
            this.socket = io.connect("/call");
            this.config = opts.config;
            this.rtc = new RTCMultiConnection();
            this.videos = {};
            this._mystreamid = null;
            this.render();

            this.on("show", function () {
                DEBUG && console.log("call_client:show");
                self.$el.show();
            });

            this.on("hide", function () {
                DEBUG && console.log("call_client:hide");
                self.$el.hide();
            });
            this.listen();

            if (!window.PeerConnection ||
                !navigator.getUserMedia) {
                $(".webrtc-error .no-webrtc", this.$el).show();
            }else {
                $(".webrtc-error .no-webrtc", this.$el).hide();
            }

            this.socket.emit('subscribe',{
                room: this.channelName
            });
        },

        toggleMuteAudio: function (ev) {
            var $this = $(ev.currentTarget);
            console.log('Muting audio');
            if ($this.hasClass("unmuted")) {
                this.rtc.streams[this._mystreamid].mute({
                    audio: true
                });
            } else {
                this.rtc.streams[this._mystreamid].unmute({
                    audio: true
                });
            }
            $this.toggleClass("unmuted");
        },

        toggleMuteVideo: function (ev) {
            var $this = $(ev.currentTarget);

            if ($this.hasClass("unmuted")) {
                this.rtc.streams[this._mystreamid].mute({
                    video: true
                });
            } else {
                this.rtc.streams[this._mystreamid].unmute({
                    video: true
                });
            }
            $this.toggleClass("unmuted");
        },

        showError: function (err, errMsg) {
            $(".no-call, .in-call", this.$el).hide();
            $(".webrtc-error, .reason.generic", this.$el).show();

            $(".reason.generic", this.$el).html("");
            $(".reason.generic", this.$el).append("<p>WebRTC failed!</p>");
            $(".reason.generic", this.$el).append("<p>" + errMsg + "</p>");
        },

        joinCall: function () {
            this.joiningCall = true;
            this.connect();
        },

        createCall: function(){
            this.joiningCall = true;
            if(!this.$el.is(':visible')) return;
            console.log('Creating call');
            this.rtc.open(this.channelName);

        },

        leaveCall: function () {
            this.inCall = false;

            $(".in-call", this.$el).hide();
            this.disconnect();
            $(".no-call", this.$el).show();
            this.showCallInProgress();

            window.events.trigger("left_call:" + this.channelName);
        },

        afterConnect: function (el) {
            var you = $('#you',this.$el);
            this.joiningCall = false;
            this.inCall = true;
            $(".no-call", this.$el).hide();
            $(".in-call", this.$el).show();

            window.events.trigger("in_call:" + this.channelName);
        },

        connect: function(){
            if(!this.$el.is(':visible')) return;
            console.log('Creating stream');
            this.socket.emit('join:'+this.channelName);
            this.rtc.connect(this.channelName);
        },

        showCallInProgress: function () {
            $(".call-status", this.$el).hide();
            $(".no-call, .call-in-progress", this.$el).show();
        },

        showNoCallInProgress: function () {
            $(".call-status", this.$el).hide();
            $(".no-call, .no-call-in-progress", this.$el).show();
        },

        listen: function(){
            var self = this;
            this.rtc.session = {
                audio: true,
                video: true
            };
            this.rtc.transmitRoomOnce = true;
            this.rtc.openSignalingChannel = function(callback) {
                self.socket.on('negotiate:'+self.channelName,function(data){
                    callback(JSON.stringify(data));
                });
                return {
                    send: function(data){
                        data = JSON.parse(data);
                        //if (data.conferencing) return;
                        self.socket.emit('negotiate:'+self.channelName,data);
                    }
                }
            };

            // on peer joining the call:
            this.rtc.onstream = function (e) {
                console.log(e);
                if (e.type === 'local') {
                    self.afterConnect($(e.mediaElement));
                    self._mystreamid = e.streamid;
                    return;
                }else if (e.type !== 'remote') return;
                var el = $(e.mediaElement);
                el[0].muted = false;
                el[0].controls = false;
                self.videos[e.userid] = el;
                $('#videos',self.$el).append(el);
                //self.subdivideVideos();
            };
            // on peer leaving the call:
            this.rtc.onstreamended = function(e) {
                console.log('remove ' + e.userid);
                self.removeVideo(e.userid);
            };
            // politely hang up before closing the tab/window
            $(window).on("unload", function () {
                self.disconnect();
            });

            this.socketEvents = {
                "status": function(data){
                    if (data.active &&
                        !self.inCall &&
                        !self.joiningCall) {

                        // show the ringing phone if we're not in/joinin a call & a call starts
                        self.showCallInProgress();
                    } else if (!data.active) {
                        self.showNoCallInProgress();
                    }
                },
                "your_id": function(data){
                    self.rtc.userid = data.id;
                }
            };
            _.each(this.socketEvents, function (value, key) {
                // listen to a subset of event
                self.socket.on(key + ":" + self.channelName, value);
            });
        },
        disconnect: function(){
            this.rtc.close();
        },
        kill: function(){
            var self = this;
            this.disconnect();
            _.each(this.socketEvents, function (method, key) {
                self.socket.removeAllListeners(key + ":" + self.channelName);
            });
            this.socket.emit('unsubscribe:'+this.channelName,{
                room: this.channelName
            });
        },
        render: function () {
            this.$el.html(this.template());
        },
        getNumPerRow: function () {
            var len = _.size(this.videos);
            var biggest;

            // Ensure length is even for better division.
            if (len % 2 === 1) {
                len++;
            }

            biggest = Math.ceil(Math.sqrt(len));
            while (len % biggest !== 0) {
                biggest++;
            }
            return biggest;
        },

        subdivideVideos: function () {
            var videos = _.values(this.videos);
            var perRow = this.getNumPerRow();
            var numInRow = 0;
            for (var i = 0, len = videos.length; i < len; i++){
                var video = videos[i];
                this.setWH(video, i,len);
                numInRow = (numInRow + 1) % perRow;
            }
        },

        setWH: function (video, i,len) {
            var perRow = this.getNumPerRow();
            var perColumn = Math.ceil(len / perRow);
            var width = Math.floor((window.innerWidth) / perRow);
            var height = Math.floor((window.innerHeight - 190) / perColumn);
            video.css({
                width: width,
                height: height,
                position: "absolute",
                left: (i % perRow) * width + "px",
                top: Math.floor(i / perRow) * height + "px"
            });
        },

        removeVideo: function (id) {
            var video = this.videos[id];
            if (video) {
                video.remove();
                delete this.videos[id];
            }
        },
        initFullScreen: function() {
            var button = document.getElementById("fullscreen");
            button.addEventListener('click', function (event) {
                var elem = document.getElementById("videos");
                //show full screen
                elem.webkitRequestFullScreen();
            });
        }
    });
});