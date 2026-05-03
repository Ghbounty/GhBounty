# Minimal GenLayer contract to isolate whether Bradbury UNDETERMINED
# failures are network-side or specific to BountyJudge's code. If this
# deploys and responds cleanly, the issue is something in bounty_judge.py
# (prompt size, eq_principle config, etc.). If this also returns
# UNDETERMINED, the network is unstable and we escalate to YeagerAI.
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class BountyJudgeMinimal(gl.Contract):
    counter: u256

    def __init__(self):
        self.counter = u256(0)

    @gl.public.write
    def bump(self) -> None:
        self.counter = u256(int(self.counter) + 1)

    @gl.public.view
    def get_counter(self) -> int:
        return int(self.counter)
