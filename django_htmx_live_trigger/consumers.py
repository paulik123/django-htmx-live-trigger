from channels.generic.websocket import AsyncWebsocketConsumer


class HTMXEventsConsumer(AsyncWebsocketConsumer):
	async def connect(self):
		self.group_name = "htmx_" + self.scope["url_route"]["kwargs"]["group_name"]
		await self.channel_layer.group_add(self.group_name, self.channel_name)

		await self.accept()

	async def disconnect(self, close_code):
		await self.channel_layer.group_discard(self.group_name, self.channel_name)

	async def trigger(self, data):
		
		await self.send(text_data=data['events'])
