include utils.mk

DOCS_THEME_DIR	= External/doxygen-awesome-css
DOCS_THEME_TAG	= v2.3.4

all: docs

$(DOCS_THEME_DIR):
	@ git -c advice.detachedHead=false clone --quiet --depth 1 --branch $(DOCS_THEME_TAG) \
		https://github.com/jothepro/doxygen-awesome-css.git $(DOCS_THEME_DIR)

docs: $(DOCS_THEME_DIR)
	@ cmake -E make_directory build/docs
	@ doxygen docs/Doxyfile
	@ $(LOG_TIME) "$(C_BLUE) OK $(C_GREEN) docs written to build/docs/html $(C_RESET)"

backend-bench:
	@ ./backend-bench/run.sh

clean:
	@ rm -rf build/docs

fclean: clean
	@ rm -rf External

re: fclean all

.PHONY: all docs backend-bench clean fclean re
