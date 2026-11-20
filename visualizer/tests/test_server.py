import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class LocalStudioTest(unittest.TestCase):
    def test_launcher_and_review_endpoint(self):
        with server.StudioServer(("127.0.0.1", 0), server.Handler) as service:
            thread = threading.Thread(target=service.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{service.server_port}"
                with urlopen(url + "/api/baseline", timeout=3) as response:
                    base = json.load(response)
                data = dict(circuits=base["circuits"], pattern=base["patterns"][0])
                request = Request(url + "/api/review", data=json.dumps(data).encode(),
                                  headers={"Content-Type": "application/json", "Origin": url})
                with urlopen(request, timeout=3) as response:
                    self.assertEqual(json.load(response)["changes"], [])
                request.add_header("Origin", "http://example.test")
                with self.assertRaises(HTTPError) as blocked:
                    urlopen(request, timeout=3)
                self.assertEqual(blocked.exception.code, 403)
                blocked.exception.close()
                with patch.object(sys, "argv", ["server.py", "--port", str(service.server_port), "--open"]), \
                     patch.object(server.webbrowser, "open") as browser, \
                     patch.object(server.StudioServer, "serve_forever", side_effect=AssertionError("Second listener opened")):
                    server.main()
                    browser.assert_called_once_with(url)
            finally:
                service.shutdown()
                thread.join()


if __name__ == "__main__":
    unittest.main()
