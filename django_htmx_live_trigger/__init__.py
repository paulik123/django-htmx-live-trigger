from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.template.loader import render_to_string


def trigger(group, events):
	channel_layer = get_channel_layer()
	async_to_sync(channel_layer.group_send)(
		"htmx_" + group, {
			"type": "trigger", 
			"events": events,
		}
	)
