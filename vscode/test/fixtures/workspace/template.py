from typing import Any, Dict, List, Tuple

from pydantic import root_validator

from cody.example.templates import BaseChattestTemplate
from cody.tests import BaseTestTemplate, testValue


def _get_example(foos: dict, foo_bar: List[str]) -> dict:
    return {k: foos[k] for k in foo_bar}


class CodyTestTemplate(BaseTestTemplate):

    final_test: BaseTestTemplate = "final test"
    cody_example: List[Tuple[str, BaseTestTemplate]] = [
        ("dummy", "dummy test")]

    @root_validator(pre=True)
    def get_template(cls, values: Dict) -> Dict:
        created_bar = set()
        all_bar = set()
        for k, test in values["cody_example"]:
            created_bar.add(k)
            all_bar.update(test.template)
        values["template"] = list(
            all_bar.difference(created_bar))
        return values

    def format_test(self, **kwargs: Any) -> testValue:
        for k, test in self.cody_example:
            _example = _get_example(kwargs, test.template)
            if isinstance(test, BaseChattestTemplate):
                kwargs[k] = test.format_messages(**_example)
            else:
                kwargs[k] = test.format(**_example)
        _example = _get_example(kwargs, self.final_test.template)
        return self.final_test.format_test(**_example)

    def format(self, **kwargs: Any) -> str:
        return self.format_test(**kwargs).to_string()

    @property
    def _test_type(self) -> str:
        raise ValueError
