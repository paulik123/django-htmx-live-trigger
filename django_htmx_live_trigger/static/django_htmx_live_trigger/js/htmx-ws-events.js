/*
WebSockets Extension
============================
This extension adds support for WebSockets to htmx.  See /www/extensions/ws.md for usage instructions.
*/

(function () {

	/** @type {import("../htmx").HtmxInternalApi} */
	var api;

	htmx.defineExtension("ws-events", {

		/**
		 * init is called once, when this extension is first registered.
		 * @param {import("../htmx").HtmxInternalApi} apiRef
		 */
		init: function (apiRef) {
			// Store reference to internal API
			api = apiRef;

			// Default function for creating new EventSource objects
			if (!htmx.createWebSocket) {
				htmx.createWebSocket = createWebSocket;
			}

			// Default setting for reconnect delay
			if (!htmx.config.wsReconnectDelay) {
				htmx.config.wsReconnectDelay = "full-jitter";
			}
		},

		/**
		 * onEvent handles all events passed to this extension.
		 *
		 * @param {string} name
		 * @param {Event} evt
		 */
		onEvent: function (name, evt) {
			var parent = evt.target || evt.detail.elt;

			switch (name) {

				// Try to close the socket when elements are removed
				case "htmx:beforeCleanupElement":

					var internalData = api.getInternalData(parent)

					if (internalData.webSocket) {
						internalData.webSocket.close();
					}
					return;

				// Try to create websockets when elements are processed
				case "htmx:beforeProcessNode":
					forEach(queryAttributeOnThisOrChildren(parent, "ws-events-connect"), function (child) {
						ensureWebSocket(child)
					});
			}
		}
	});

	function getLegacyWebsocketURL(elt) {
        return null
	}

	/**
	 * ensureWebSocket creates a new WebSocket on the designated element, using
	 * the element's "ws-connect" attribute.
	 * @param {HTMLElement} socketElt
	 * @returns
	 */
	function ensureWebSocket(socketElt) {

		// If the element containing the WebSocket connection no longer exists, then
		// do not connect/reconnect the WebSocket.
		if (!api.bodyContains(socketElt)) {
			return;
		}

		// Get the source straight from the element's value
		var wssSource = api.getAttributeValue(socketElt, "ws-events-connect")

		if (wssSource == null || wssSource === "") {
			var legacySource = getLegacyWebsocketURL(socketElt);
			if (legacySource == null) {
				return;
			} else {
				wssSource = legacySource;
			}
		}

		// Guarantee that the wssSource value is a fully qualified URL
		if (wssSource.indexOf("/") === 0) {
			var base_part = location.hostname + (location.port ? ':' + location.port : '');
			if (location.protocol === 'https:') {
				wssSource = "wss://" + base_part + wssSource;
			} else if (location.protocol === 'http:') {
				wssSource = "ws://" + base_part + wssSource;
			}
		}

		var socketWrapper = createWebsocketWrapper(socketElt, function () {
			return htmx.createWebSocket(wssSource)
		});

		socketWrapper.addEventListener('message', function (event) {
			if (maybeCloseWebSocketSource(socketElt)) {
				return;
			}

			var response = event.data;
			if (!api.triggerEvent(socketElt, "htmx:wsEventBeforeMessage", {
				message: response,
				socketWrapper: socketWrapper.publicInterface
			})) {
				return;
			}

            if(response.indexOf("{") === 0) {
                var events = JSON.parse(response)
				console.log("MULTIPLE EVENTS: ", events)
                for (var eventName in events) {
                    api.triggerEvent(socketElt, eventName, {value:events[eventName] });
                }
            } else {
				console.log("SINGLE EVENT: ", response)
                api.triggerEvent(socketElt, response)
            }

			console.log(event)

			api.triggerEvent(socketElt, "htmx:wsEventAfterMessage", { message: response, socketWrapper: socketWrapper.publicInterface })
		});

		// Put the WebSocket into the HTML Element's custom data.
		api.getInternalData(socketElt).webSocket = socketWrapper;
	}

	/**
	 * @typedef {Object} WebSocketWrapper
	 * @property {WebSocket} socket
	 * @property {Array<{message: string, sendElt: Element}>} messageQueue
	 * @property {number} retryCount
	 * @property {(message: string, sendElt: Element) => void} sendImmediately sendImmediately sends message regardless of websocket connection state
	 * @property {(message: string, sendElt: Element) => void} send
	 * @property {(event: string, handler: Function) => void} addEventListener
	 * @property {() => void} handleQueuedMessages
	 * @property {() => void} init
	 * @property {() => void} close
	 */
	/**
	 *
	 * @param socketElt
	 * @param socketFunc
	 * @returns {WebSocketWrapper}
	 */
	function createWebsocketWrapper(socketElt, socketFunc) {
		var wrapper = {
			socket: null,
			retryCount: 0,

			/** @type {Object<string, Function[]>} */
			events: {},

			addEventListener: function (event, handler) {
				if (this.socket) {
					this.socket.addEventListener(event, handler);
				}

				if (!this.events[event]) {
					this.events[event] = [];
				}

				this.events[event].push(handler);
			},


			init: function () {
				if (this.socket && this.socket.readyState === this.socket.OPEN) {
					// Close discarded socket
					this.socket.close()
				}

				// Create a new WebSocket and event handlers
				/** @type {WebSocket} */
				var socket = socketFunc();

				// The event.type detail is added for interface conformance with the
				// other two lifecycle events (open and close) so a single handler method
				// can handle them polymorphically, if required.
				api.triggerEvent(socketElt, "htmx:wsEventConnecting", { event: { type: 'connecting' } });

				this.socket = socket;

				socket.onopen = function (e) {
					wrapper.retryCount = 0;
					api.triggerEvent(socketElt, "htmx:wsEventOpen", { event: e, socketWrapper: wrapper.publicInterface });
				}

				socket.onclose = function (e) {
					// If socket should not be connected, stop further attempts to establish connection
					// If Abnormal Closure/Service Restart/Try Again Later, then set a timer to reconnect after a pause.
					if (!maybeCloseWebSocketSource(socketElt) && [1006, 1012, 1013].indexOf(e.code) >= 0) {
						var delay = getWebSocketReconnectDelay(wrapper.retryCount);
						setTimeout(function () {
							wrapper.retryCount += 1;
							wrapper.init();
						}, delay);
					}

					// Notify client code that connection has been closed. Client code can inspect `event` field
					// to determine whether closure has been valid or abnormal
					api.triggerEvent(socketElt, "htmx:wsEventClose", { event: e, socketWrapper: wrapper.publicInterface })
				};

				socket.onerror = function (e) {
					api.triggerErrorEvent(socketElt, "htmx:wsEventError", { error: e, socketWrapper: wrapper });
					maybeCloseWebSocketSource(socketElt);
				};

				var events = this.events;
				Object.keys(events).forEach(function (k) {
					events[k].forEach(function (e) {
						socket.addEventListener(k, e);
					})
				});
			},

			close: function () {
				this.socket.close()
			}
		}

		wrapper.init();

		wrapper.publicInterface = {

		};

		return wrapper;
	}


	/**
	 * getWebSocketReconnectDelay is the default easing function for WebSocket reconnects.
	 * @param {number} retryCount // The number of retries that have already taken place
	 * @returns {number}
	 */
	function getWebSocketReconnectDelay(retryCount) {

		/** @type {"full-jitter" | ((retryCount:number) => number)} */
		var delay = htmx.config.wsReconnectDelay;
		if (typeof delay === 'function') {
			return delay(retryCount);
		}
		if (delay === 'full-jitter') {
			var exp = Math.min(retryCount, 6);
			var maxDelay = 1000 * Math.pow(2, exp);
			return maxDelay * Math.random();
		}

		logError('htmx.config.wsReconnectDelay must either be a function or the string "full-jitter"');
	}

	/**
	 * maybeCloseWebSocketSource checks to the if the element that created the WebSocket
	 * still exists in the DOM.  If NOT, then the WebSocket is closed and this function
	 * returns TRUE.  If the element DOES EXIST, then no action is taken, and this function
	 * returns FALSE.
	 *
	 * @param {*} elt
	 * @returns
	 */
	function maybeCloseWebSocketSource(elt) {
		if (!api.bodyContains(elt)) {
			api.getInternalData(elt).webSocket.close();
			return true;
		}
		return false;
	}

	/**
	 * createWebSocket is the default method for creating new WebSocket objects.
	 * it is hoisted into htmx.createWebSocket to be overridden by the user, if needed.
	 *
	 * @param {string} url
	 * @returns WebSocket
	 */
	function createWebSocket(url) {
		var sock = new WebSocket(url, []);
		sock.binaryType = htmx.config.wsBinaryType;
		return sock;
	}

	/**
	 * queryAttributeOnThisOrChildren returns all nodes that contain the requested attributeName, INCLUDING THE PROVIDED ROOT ELEMENT.
	 *
	 * @param {HTMLElement} elt
	 * @param {string} attributeName
	 */
	function queryAttributeOnThisOrChildren(elt, attributeName) {

		var result = []

		// If the parent element also contains the requested attribute, then add it to the results too.
		if (api.hasAttribute(elt, attributeName) || api.hasAttribute(elt, "hx-ws")) {
			result.push(elt);
		}

		// Search all child nodes that match the requested attribute
		elt.querySelectorAll("[" + attributeName + "], [data-" + attributeName + "], [data-hx-ws], [hx-ws]").forEach(function (node) {
			result.push(node)
		})

		return result
	}

	/**
	 * @template T
	 * @param {T[]} arr
	 * @param {(T) => void} func
	 */
	function forEach(arr, func) {
		if (arr) {
			for (var i = 0; i < arr.length; i++) {
				func(arr[i]);
			}
		}
	}

})();
