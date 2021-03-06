import {
	OptionsWithUri,
} from 'request';

import { IDataObject } from 'n8n-workflow';

import {
	BINARY_ENCODING,
	IExecuteFunctions,
	IExecuteSingleFunctions,
	ILoadOptionsFunctions,
} from 'n8n-core';

import * as _ from 'lodash';
import * as uuid from 'uuid/v4';


interface MessageResponse {
	chunk: Message[];
}

interface Message {
	content: object;
	room_id: string;
	sender: string;
	type: string;
	user_id: string;

}

export async function matrixApiRequest(this: IExecuteFunctions | IExecuteSingleFunctions | ILoadOptionsFunctions, method: string, resource: string, body: string | object = {}, query: object = {}, headers: {} | undefined = undefined, option: {} = {}): Promise<any> { // tslint:disable-line:no-any
	let options: OptionsWithUri = {
		method,
		headers: headers || {
			'Content-Type': 'application/json; charset=utf-8',
		},
		body,
		qs: query,
		uri: '',
		json: true,
	};
	options = Object.assign({}, options, option);
	if (Object.keys(body).length === 0) {
		delete options.body;
	}
	if (Object.keys(query).length === 0) {
		delete options.qs;
	}
	try {

		let response: any; // tslint:disable-line:no-any

		const credentials = this.getCredentials('matrixApi');
		if (credentials === undefined) {
			throw new Error('No credentials got returned!');
		}
		//@ts-ignore
		options.uri = `${credentials.homeserverUrl}/_matrix/${option.overridePrefix || 'client'}/r0${resource}`;
		options.headers!.Authorization = `Bearer ${credentials.accessToken}`;
		//@ts-ignore
		response = await this.helpers.request(options);

		// When working with images, the request cannot be JSON (it's raw binary data)
		// But the output is JSON so we have to parse it manually.
		//@ts-ignore
		return options.overridePrefix === 'media' ? JSON.parse(response) : response;
	} catch (error) {
		if (error.statusCode === 401) {
			// Return a clear error
			throw new Error('Matrix credentials are not valid!');
		}

		if (error.response && error.response.body && error.response.body.error) {
			// Try to return the error prettier
			throw new Error(`Matrix error response [${error.statusCode}]: ${error.response.body.error}`);
		}

		// If that data does not exist for some reason return the actual error
		throw error;
	}
}

export async function handleMatrixCall(this: IExecuteFunctions | IExecuteSingleFunctions | ILoadOptionsFunctions, item: IDataObject, index: number, resource: string, operation: string): Promise<any> { // tslint:disable-line:no-any

	if (resource === 'account') {
		if (operation === 'me') {
			return await matrixApiRequest.call(this, 'GET', '/account/whoami');
		}
	}
	else if (resource === 'room') {
		if (operation === 'create') {
			const name = this.getNodeParameter('roomName', index) as string;
			const preset = this.getNodeParameter('preset', index) as string;
			const roomAlias = this.getNodeParameter('roomAlias', index) as string;
			const body: IDataObject = {
				name,
				preset,
			};
			if (roomAlias) {
				body.room_alias_name = roomAlias;
			}
			return await matrixApiRequest.call(this, 'POST', `/createRoom`, body);
		} else if (operation === 'join') {
			const roomIdOrAlias = this.getNodeParameter('roomIdOrAlias', index) as string;
			return await matrixApiRequest.call(this, 'POST', `/rooms/${roomIdOrAlias}/join`);
		} else if (operation === 'leave') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			return await matrixApiRequest.call(this, 'POST', `/rooms/${roomId}/leave`);
		} else if (operation === 'invite') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const userId = this.getNodeParameter('userId', index) as string;
			const body: IDataObject = {
				user_id: userId,
			};
			return await matrixApiRequest.call(this, 'POST', `/rooms/${roomId}/invite`, body);
		} else if (operation === 'kick') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const userId = this.getNodeParameter('userId', index) as string;
			const reason = this.getNodeParameter('reason', index) as string;
			const body: IDataObject = {
				user_id: userId,
				reason,
			};
			return await matrixApiRequest.call(this, 'POST', `/rooms/${roomId}/kick`, body);
		}
	} else if (resource === 'message') {
		if (operation === 'create') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const text = this.getNodeParameter('text', index) as string;
			const body: IDataObject = {
				msgtype: 'm.text',
				body: text,
			};
			const messageId = uuid();
			return await matrixApiRequest.call(this, 'PUT', `/rooms/${roomId}/send/m.room.message/${messageId}`, body);
		} else if (operation === 'getAll') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const returnAll = this.getNodeParameter('returnAll', index) as boolean;
			const otherOptions = this.getNodeParameter('otherOptions', index) as IDataObject;
			const returnData: IDataObject[] = [];

			if (returnAll) {
				let responseData;
				let from;
				do {
					const qs: IDataObject = {
						dir: 'b', // Get latest messages first - doesn't return anything if we use f without a previous token.
						from,
					};

					if (otherOptions.filter) {
						qs.filter = otherOptions.filter;
					}

					responseData = await matrixApiRequest.call(this, 'GET', `/rooms/${roomId}/messages`, {}, qs);
					returnData.push.apply(returnData, responseData.chunk);
					from = responseData.end;
				} while (responseData.chunk.length > 0);
			} else {
				const limit = this.getNodeParameter('limit', index) as number;
				const qs: IDataObject = {
					dir: 'b', // Get latest messages first - doesn't return anything if we use f without a previous token.
					limit,
				};

				if (otherOptions.filter) {
					qs.filter = otherOptions.filter;
				}

				const responseData = await matrixApiRequest.call(this, 'GET', `/rooms/${roomId}/messages`, {}, qs);
				returnData.push.apply(returnData, responseData.chunk);
			}

			return returnData;
		}
	} else if (resource === 'event') {
		if (operation === 'get') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const eventId = this.getNodeParameter('eventId', index) as string;
			return await matrixApiRequest.call(this, 'GET', `/rooms/${roomId}/event/${eventId}`);
		}
	} else if (resource === 'media') {
		if (operation === 'upload') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const mediaType = this.getNodeParameter('mediaType', index) as string;
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', index) as string;

			let body;
			const qs: IDataObject = {};
			const headers: IDataObject = {};
			let filename;

			if (item.binary === undefined
				//@ts-ignore
				|| item.binary[binaryPropertyName] === undefined) {
				throw new Error(`No binary data property "${binaryPropertyName}" does not exists on item!`);
			}

			//@ts-ignore
			qs.filename = item.binary[binaryPropertyName].fileName;
			//@ts-ignore
			filename = item.binary[binaryPropertyName].fileName;

			//@ts-ignore
			body = Buffer.from(item.binary[binaryPropertyName].data, BINARY_ENCODING);
			//@ts-ignore
			headers['Content-Type'] = item.binary[binaryPropertyName].mimeType;
			headers['accept'] = 'application/json,text/*;q=0.99';

			const uploadRequestResult = await matrixApiRequest.call(this, 'POST', `/upload`, body, qs, headers, {
				overridePrefix: 'media',
				json: false,
			});

			body = {
				msgtype: `m.${mediaType}`,
				body: filename,
				url: uploadRequestResult.content_uri,
			};
			const messageId = uuid();
			return await matrixApiRequest.call(this, 'PUT', `/rooms/${roomId}/send/m.room.message/${messageId}`, body);

		}
	} else if (resource === 'roomMember') {
		if (operation === 'getAll') {
			const roomId = this.getNodeParameter('roomId', index) as string;
			const filters = this.getNodeParameter('filters', index) as IDataObject;
			const qs: IDataObject = {
				membership: filters.membership ? filters.membership : '',
				not_membership: filters.notMembership ? filters.notMembership : '',
			};
			const roomMembersResponse = await matrixApiRequest.call(this, 'GET', `/rooms/${roomId}/members`, {}, qs);
			return roomMembersResponse.chunk;
		}
	}


	throw new Error('Not implemented yet');
}
