/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module utils/emittermixin
 */

import EventInfo from './eventinfo';
import uid from './uid';
import priorities from './priorities';

const _listeningTo = Symbol( 'listeningTo' );
const _emitterId = Symbol( 'emitterId' );

/**
 * Mixin that injects the events API into its host.
 *
 * @mixin EmitterMixin
 * @implements module:utils/emittermixin~Emitter
 */
const EmitterMixin = {
	/**
	 * Registers a callback function to be executed when an event is fired.
	 *
	 * Events can be grouped in namespaces using `:`.
	 * When namespaced event is fired, it additionaly fires all callbacks for that namespace.
	 *
	 *		myEmitter.on( 'myGroup', genericCallback );
	 *		myEmitter.on( 'myGroup:myEvent', specificCallback );
	 *
	 *		// genericCallback is fired.
	 *		myEmitter.fire( 'myGroup' );
	 *		// both genericCallback and specificCallback are fired.
	 *		myEmitter.fire( 'myGroup:myEvent' );
	 *		// genericCallback is fired even though there are no callbacks for "foo".
	 *		myEmitter.fire( 'myGroup:foo' );
	 *
	 * An event callback can {@link module:utils/eventinfo~EventInfo#stop stop the event} and
	 * set the {@link module:utils/eventinfo~EventInfo#return return value} of the {@link #fire} method.
	 *
	 * @method #on
	 * @param {String} event The name of the event.
	 * @param {Function} callback The function to be called on event.
	 * @param {Object} [options={}] Additional options.
	 * @param {module:utils/priorities~PriorityString|Number} [options.priority='normal'] The priority of this event callback. The higher
	 * the priority value the sooner the callback will be fired. Events having the same priority are called in the
	 * order they were added.
	 * @param {Object} [options.context] The object that represents `this` in the callback. Defaults to the object firing the event.
	 */
	on( event, callback, options = {} ) {
		createEventNamespace( this, event );
		const lists = getCallbacksListsForNamespace( this, event );
		const priority = priorities.get( options.priority );

		callback = {
			callback,
			context: options.context || this,
			priority
		};

		// Add the callback to all callbacks list.
		for ( const callbacks of lists ) {
			// Add the callback to the list in the right priority position.
			let added = false;

			for ( let i = 0; i < callbacks.length; i++ ) {
				if ( callbacks[ i ].priority < priority ) {
					callbacks.splice( i, 0, callback );
					added = true;

					break;
				}
			}

			// Add at the end, if right place was not found.
			if ( !added ) {
				callbacks.push( callback );
			}
		}
	},

	/**
	 * Registers a callback function to be executed on the next time the event is fired only. This is similar to
	 * calling {@link #on} followed by {@link #off} in the callback.
	 *
	 * @method #once
	 * @param {String} event The name of the event.
	 * @param {Function} callback The function to be called on event.
	 * @param {Object} [options={}] Additional options.
	 * @param {module:utils/priorities~PriorityString|Number} [options.priority='normal'] The priority of this event callback. The higher
	 * the priority value the sooner the callback will be fired. Events having the same priority are called in the
	 * order they were added.
	 * @param {Object} [options.context] The object that represents `this` in the callback. Defaults to the object firing the event.
	 */
	once( event, callback, options ) {
		const onceCallback = function( event, ...args ) {
			// Go off() at the first call.
			event.off();

			// Go with the original callback.
			callback.call( this, event, ...args );
		};

		// Make a similar on() call, simply replacing the callback.
		this.on( event, onceCallback, options );
	},

	/**
	 * Stops executing the callback on the given event.
	 *
	 * @method #off
	 * @param {String} event The name of the event.
	 * @param {Function} callback The function to stop being called.
	 * @param {Object} [context] The context object to be removed, pared with the given callback. To handle cases where
	 * the same callback is used several times with different contexts.
	 */
	off( event, callback, context ) {
		const lists = getCallbacksListsForNamespace( this, event );

		for ( const callbacks of lists ) {
			for ( let i = 0; i < callbacks.length; i++ ) {
				if ( callbacks[ i ].callback == callback ) {
					if ( !context || context == callbacks[ i ].context ) {
						// Remove the callback from the list (fixing the next index).
						callbacks.splice( i, 1 );
						i--;
					}
				}
			}
		}
	},

	/**
	 * Registers a callback function to be executed when an event is fired in a specific (emitter) object.
	 *
	 * @method #listenTo
	 * @param {module:utils/emittermixin~Emitter} emitter The object that fires the event.
	 * @param {String} event The name of the event.
	 * @param {Function} callback The function to be called on event.
	 * @param {Object} [options={}] Additional options.
	 * @param {module:utils/priorities~PriorityString|Number} [options.priority='normal'] The priority of this event callback. The higher
	 * the priority value the sooner the callback will be fired. Events having the same priority are called in the
	 * order they were added.
	 * @param {Object} [options.context] The object that represents `this` in the callback. Defaults to the object firing the event.
	 */
	listenTo( emitter, event, callback, options ) {
		let emitterInfo, eventCallbacks;

		// _listeningTo contains a list of emitters that this object is listening to.
		// This list has the following format:
		//
		// _listeningTo: {
		//     emitterId: {
		//         emitter: emitter,
		//         callbacks: {
		//             event1: [ callback1, callback2, ... ]
		//             ....
		//         }
		//     },
		//     ...
		// }

		if ( !this[ _listeningTo ] ) {
			this[ _listeningTo ] = {};
		}

		const emitters = this[ _listeningTo ];

		if ( !_getEmitterId( emitter ) ) {
			_setEmitterId( emitter );
		}

		const emitterId = _getEmitterId( emitter );

		if ( !( emitterInfo = emitters[ emitterId ] ) ) {
			emitterInfo = emitters[ emitterId ] = {
				emitter,
				callbacks: {}
			};
		}

		if ( !( eventCallbacks = emitterInfo.callbacks[ event ] ) ) {
			eventCallbacks = emitterInfo.callbacks[ event ] = [];
		}

		eventCallbacks.push( callback );

		// Finally register the callback to the event.
		emitter.on( event, callback, options );
	},

	/**
	 * Stops listening for events. It can be used at different levels:
	 *
	 * * To stop listening to a specific callback.
	 * * To stop listening to a specific event.
	 * * To stop listening to all events fired by a specific object.
	 * * To stop listening to all events fired by all object.
	 *
	 * @method #stopListening
	 * @param {module:utils/emittermixin~Emitter} [emitter] The object to stop listening to. If omitted, stops it for all objects.
	 * @param {String} [event] (Requires the `emitter`) The name of the event to stop listening to. If omitted, stops it
	 * for all events from `emitter`.
	 * @param {Function} [callback] (Requires the `event`) The function to be removed from the call list for the given
	 * `event`.
	 */
	stopListening( emitter, event, callback ) {
		const emitters = this[ _listeningTo ];
		let emitterId = emitter && _getEmitterId( emitter );
		const emitterInfo = emitters && emitterId && emitters[ emitterId ];
		const eventCallbacks = emitterInfo && event && emitterInfo.callbacks[ event ];

		// Stop if nothing has been listened.
		if ( !emitters || ( emitter && !emitterInfo ) || ( event && !eventCallbacks ) ) {
			return;
		}

		// All params provided. off() that single callback.
		if ( callback ) {
			emitter.off( event, callback );
		}
		// Only `emitter` and `event` provided. off() all callbacks for that event.
		else if ( eventCallbacks ) {
			while ( ( callback = eventCallbacks.pop() ) ) {
				emitter.off( event, callback );
			}
			delete emitterInfo.callbacks[ event ];
		}
		// Only `emitter` provided. off() all events for that emitter.
		else if ( emitterInfo ) {
			for ( event in emitterInfo.callbacks ) {
				this.stopListening( emitter, event );
			}
			delete emitters[ emitterId ];
		}
		// No params provided. off() all emitters.
		else {
			for ( emitterId in emitters ) {
				this.stopListening( emitters[ emitterId ].emitter );
			}
			delete this[ _listeningTo ];
		}
	},

	/**
	 * Fires an event, executing all callbacks registered for it.
	 *
	 * The first parameter passed to callbacks is an {@link module:utils/eventinfo~EventInfo} object,
	 * followed by the optional `args` provided in the `fire()` method call.
	 *
	 * @method #fire
	 * @param {String|module:utils/eventinfo~EventInfo} eventOrInfo The name of the event or `EventInfo` object if event is delegated.
	 * @param {...*} [args] Additional arguments to be passed to the callbacks.
	 * @returns {*} By default the method returns `undefined`. However, the return value can be changed by listeners
	 * through modification of the {@link module:utils/eventinfo~EventInfo#return}'s value (the event info
	 * is the first param of every callback).
	 */
	fire( eventOrInfo, ...args ) {
		const eventInfo = eventOrInfo instanceof EventInfo ? eventOrInfo : new EventInfo( this, eventOrInfo );
		const event = eventInfo.name;
		let callbacks = getCallbacksForEvent( this, event );

		// Record that the event passed this emitter on its path.
		eventInfo.path.push( this );

		// Handle event listener callbacks first.
		if ( callbacks ) {
			// Arguments passed to each callback.
			const callbackArgs = [ eventInfo, ...args ];

			// Copying callbacks array is the easiest and most secure way of preventing infinite loops, when event callbacks
			// are added while processing other callbacks. Previous solution involved adding counters (unique ids) but
			// failed if callbacks were added to the queue before currently processed callback.
			// If this proves to be too inefficient, another method is to change `.on()` so callbacks are stored if same
			// event is currently processed. Then, `.fire()` at the end, would have to add all stored events.
			callbacks = Array.from( callbacks );

			for ( let i = 0; i < callbacks.length; i++ ) {
				callbacks[ i ].callback.apply( callbacks[ i ].context, callbackArgs );

				// Remove the callback from future requests if off() has been called.
				if ( eventInfo.off.called ) {
					// Remove the called mark for the next calls.
					delete eventInfo.off.called;

					this.off( event, callbacks[ i ].callback, callbacks[ i ].context );
				}

				// Do not execute next callbacks if stop() was called.
				if ( eventInfo.stop.called ) {
					break;
				}
			}
		}

		// Delegate event to other emitters if needed.
		if ( this._delegations ) {
			const destinations = this._delegations.get( event );
			const passAllDestinations = this._delegations.get( '*' );

			if ( destinations ) {
				fireDelegatedEvents( destinations, eventInfo, args );
			}

			if ( passAllDestinations ) {
				fireDelegatedEvents( passAllDestinations, eventInfo, args );
			}
		}

		return eventInfo.return;
	},

	/**
	 * Delegates selected events to another {@link module:utils/emittermixin~Emitter}. For instance:
	 *
	 *		emitterA.delegate( 'eventX' ).to( emitterB );
	 *		emitterA.delegate( 'eventX', 'eventY' ).to( emitterC );
	 *
	 * then `eventX` is delegated (fired by) `emitterB` and `emitterC` along with `data`:
	 *
	 *		emitterA.fire( 'eventX', data );
	 *
	 * and `eventY` is delegated (fired by) `emitterC` along with `data`:
	 *
	 *		emitterA.fire( 'eventY', data );
	 *
	 * @method #delegate
	 * @param {...String} events Event names that will be delegated to another emitter.
	 * @returns {module:utils/emittermixin~EmitterMixinDelegateChain}
	 */
	delegate( ...events ) {
		return {
			to: ( emitter, nameOrFunction ) => {
				if ( !this._delegations ) {
					this._delegations = new Map();
				}

				for ( const eventName of events ) {
					const destinations = this._delegations.get( eventName );

					if ( !destinations ) {
						this._delegations.set( eventName, new Map( [ [ emitter, nameOrFunction ] ] ) );
					} else {
						destinations.set( emitter, nameOrFunction );
					}
				}
			}
		};
	},

	/**
	 * Stops delegating events. It can be used at different levels:
	 *
	 * * To stop delegating all events.
	 * * To stop delegating a specific event to all emitters.
	 * * To stop delegating a specific event to a specific emitter.
	 *
	 * @method #stopDelegating
	 * @param {String} [event] The name of the event to stop delegating. If omitted, stops it all delegations.
	 * @param {module:utils/emittermixin~Emitter} [emitter] (requires `event`) The object to stop delegating a particular event to.
	 * If omitted, stops delegation of `event` to all emitters.
	 */
	stopDelegating( event, emitter ) {
		if ( !this._delegations ) {
			return;
		}

		if ( !event ) {
			this._delegations.clear();
		} else if ( !emitter ) {
			this._delegations.delete( event );
		} else {
			const destinations = this._delegations.get( event );

			if ( destinations ) {
				destinations.delete( emitter );
			}
		}
	}
};

export default EmitterMixin;

/**
 * Checks if `listeningEmitter` listens to an emitter with given `listenedToEmitterId` and if so, returns that emitter.
 * If not, returns `null`.
 *
 * @protected
 * @param {module:utils/emittermixin~EmitterMixin} listeningEmitter Emitter that listens.
 * @param {String} listenedToEmitterId Unique emitter id of emitter listened to.
 * @returns {module:utils/emittermixin~EmitterMixin|null}
 */
export function _getEmitterListenedTo( listeningEmitter, listenedToEmitterId ) {
	if ( listeningEmitter[ _listeningTo ] && listeningEmitter[ _listeningTo ][ listenedToEmitterId ] ) {
		return listeningEmitter[ _listeningTo ][ listenedToEmitterId ].emitter;
	}

	return null;
}

/**
 * Sets emitter's unique id.
 *
 * **Note:** `_emitterId` can be set only once.
 *
 * @protected
 * @param {module:utils/emittermixin~EmitterMixin} emitter Emitter for which id will be set.
 * @param {String} [id] Unique id to set. If not passed, random unique id will be set.
 */
export function _setEmitterId( emitter, id ) {
	if ( !emitter[ _emitterId ] ) {
		emitter[ _emitterId ] = id || uid();
	}
}

/**
 * Returns emitter's unique id.
 *
 * @protected
 * @param {module:utils/emittermixin~EmitterMixin} emitter Emitter which id will be returned.
 */
export function _getEmitterId( emitter ) {
	return emitter[ _emitterId ];
}

// Gets the internal `_events` property of the given object.
// `_events` property store all lists with callbacks for registered event names.
// If there were no events registered on the object, empty `_events` object is created.
function getEvents( source ) {
	if ( !source._events ) {
		Object.defineProperty( source, '_events', {
			value: {}
		} );
	}

	return source._events;
}

// Creates event node for generic-specific events relation architecture.
function makeEventNode() {
	return {
		callbacks: [],
		childEvents: []
	};
}

// Creates an architecture for generic-specific events relation.
// If needed, creates all events for given eventName, i.e. if the first registered event
// is foo:bar:abc, it will create foo:bar:abc, foo:bar and foo event and tie them together.
// It also copies callbacks from more generic events to more specific events when
// specific events are created.
function createEventNamespace( source, eventName ) {
	const events = getEvents( source );

	// First, check if the event we want to add to the structure already exists.
	if ( events[ eventName ] ) {
		// If it exists, we don't have to do anything.
		return;
	}

	// In other case, we have to create the structure for the event.
	// Note, that we might need to create intermediate events too.
	// I.e. if foo:bar:abc is being registered and we only have foo in the structure,
	// we need to also register foo:bar.

	// Currently processed event name.
	let name = eventName;
	// Name of the event that is a child event for currently processed event.
	let childEventName = null;

	// Array containing all newly created specific events.
	const newEventNodes = [];

	// While loop can't check for ':' index because we have to handle generic events too.
	// In each loop, we truncate event name, going from the most specific name to the generic one.
	// I.e. foo:bar:abc -> foo:bar -> foo.
	while ( name !== '' ) {
		if ( events[ name ] ) {
			// If the currently processed event name is already registered, we can be sure
			// that it already has all the structure created, so we can break the loop here
			// as no more events need to be registered.
			break;
		}

		// If this event is not yet registered, create a new object for it.
		events[ name ] = makeEventNode();
		// Add it to the array with newly created events.
		newEventNodes.push( events[ name ] );

		// Add previously processed event name as a child of this event.
		if ( childEventName ) {
			events[ name ].childEvents.push( childEventName );
		}

		childEventName = name;
		// If `.lastIndexOf()` returns -1, `.substr()` will return '' which will break the loop.
		name = name.substr( 0, name.lastIndexOf( ':' ) );
	}

	if ( name !== '' ) {
		// If name is not empty, we found an already registered event that was a parent of the
		// event we wanted to register.

		// Copy that event's callbacks to newly registered events.
		for ( const node of newEventNodes ) {
			node.callbacks = events[ name ].callbacks.slice();
		}

		// Add last newly created event to the already registered event.
		events[ name ].childEvents.push( childEventName );
	}
}

// Gets an array containing callbacks list for a given event and it's more specific events.
// I.e. if given event is foo:bar and there is also foo:bar:abc event registered, this will
// return callback list of foo:bar and foo:bar:abc (but not foo).
// Returns empty array if given event has not been yet registered.
function getCallbacksListsForNamespace( source, eventName ) {
	const eventNode = getEvents( source )[ eventName ];

	if ( !eventNode ) {
		return [];
	}

	let callbacksLists = [ eventNode.callbacks ];

	for ( let i = 0; i < eventNode.childEvents.length; i++ ) {
		const childCallbacksLists = getCallbacksListsForNamespace( source, eventNode.childEvents[ i ] );

		callbacksLists = callbacksLists.concat( childCallbacksLists );
	}

	return callbacksLists;
}

// Get the list of callbacks for a given event, but only if there any callbacks have been registered.
// If there are no callbacks registered for given event, it checks if this is a specific event and looks
// for callbacks for it's more generic version.
function getCallbacksForEvent( source, eventName ) {
	let event;

	if ( !source._events || !( event = source._events[ eventName ] ) || !event.callbacks.length ) {
		// There are no callbacks registered for specified eventName.
		// But this could be a specific-type event that is in a namespace.
		if ( eventName.indexOf( ':' ) > -1 ) {
			// If the eventName is specific, try to find callback lists for more generic event.
			return getCallbacksForEvent( source, eventName.substr( 0, eventName.lastIndexOf( ':' ) ) );
		} else {
			// If this is a top-level generic event, return null;
			return null;
		}
	}

	return event.callbacks;
}

// Fires delegated events for given map of destinations.
//
// @private
// * @param {Map.<utils.Emitter>} destinations A map containing `[ {@link utils.Emitter}, "event name" ]` pair destinations.
// * @param {utils.EventInfo} eventInfo The original event info object.
// * @param {Array.<*>} fireArgs Arguments the original event was fired with.
function fireDelegatedEvents( destinations, eventInfo, fireArgs ) {
	for ( let [ emitter, name ] of destinations ) {
		if ( !name ) {
			name = eventInfo.name;
		} else if ( typeof name == 'function' ) {
			name = name( eventInfo.name );
		}

		const delegatedInfo = new EventInfo( eventInfo.source, name );

		delegatedInfo.path = [ ...eventInfo.path ];

		emitter.fire( delegatedInfo, ...fireArgs );
	}
}

/**
 * Interface representing classes which mix in {@link module:utils/emittermixin~EmitterMixin}.
 *
 * @interface Emitter
 */

/**
 * The return value of {@link ~EmitterMixin#delegate}.
 *
 * @interface module:utils/emittermixin~EmitterMixinDelegateChain
 */

/**
 * Selects destination for {@link module:utils/emittermixin~EmitterMixin#delegate} events.
 *
 * @method #to
 * @param {module:utils/emittermixin~Emitter} emitter An `EmitterMixin` instance which is the destination for delegated events.
 * @param {String|Function} nameOrFunction A custom event name or function which converts the original name string.
 */
