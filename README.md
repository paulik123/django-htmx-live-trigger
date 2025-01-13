### Trigger HTMX events usign Django Channels and websockets

An example project can be found at https://github.com/paulik123/django-htmx-live-trigger-example

This app assumes you have working `Django + Channels` project.
If you don't know how to set it up, you can follow this tutorial:
https://channels.readthedocs.io/en/latest/tutorial/part_1.html


### Installation:
```bash
pip install django-htmx-live-trigger
```


Then add `django_htmx_live_trigger` to you `INSTALLED_APPS`
```python
INSTALLED_APPS = [
    ...,
    "django_htmx_live_trigger",
]
```

Then add `HTMXEventsConsumer` to your websocket routing in `asgi.py`

```python
from django.urls import re_path
from django_htmx_live_trigger.consumers import HTMXEventsConsumer
 
...

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(
            AuthMiddlewareStack(
				URLRouter([
					# ...
					re_path(r"ws/events/(?P<group_name>\w+)/$", HTMXEventsConsumer.as_asgi()),
                ])
            )
        ),
    }
)
```


### Usage:

1. Add `<script src="{% static 'django_htmx_live_trigger/js/htmx-ws-events.js' %}"></script>` at the end of your body (after htmx).
2. Add the `hx-ext="ws-events"` and `ws-events-connect="/ws/events/<group_name>/"` attributes to your `<body>`.

Then, wherever you want in you project, you can trigger the events like so:

```python
from django_htmx_live_trigger import trigger

trigger("<group_name>", "<event-name>")
```

You can also trigger multiple events at once like so:
```python
from django_htmx_live_trigger import trigger
import json

trigger("<group_name>", json.dumps({"event1": "value1", "event2": "value2"}))
```


### Example
```html
...

<body hx-ext="ws-events" ws-events-connect="/ws/events/notifications/">
    <div hx-get="{% url 'fetch_notifications' %}" hx-trigger="new-notification from:body"></div>

    <script src="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js"></script>
    <script src="{% static 'django_htmx_live_trigger/js/htmx-ws-events.js' %}"></script>
</body>
...
```

```python
from django_htmx_live_trigger import trigger

class Notificaiton(models.Model):
    ...

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)

        if is_new:
            trigger("notifications", "new-notification")
```