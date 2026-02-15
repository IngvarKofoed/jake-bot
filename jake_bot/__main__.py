import logging

from .bot import JakeBot
from .config import Config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)

config = Config.from_env()
bot = JakeBot(config)
bot.run(config.discord_token, log_handler=None)
