/* Forced macOS CoW file copies. NUL-delimited source/destination pairs on stdin. */
#include <sys/clonefile.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

int main(void) {
  char *source = NULL, *destination = NULL;
  size_t source_capacity = 0, destination_capacity = 0;
  int result = 0;
  while (getdelim(&source, &source_capacity, '\0', stdin) > 0) {
    if (getdelim(&destination, &destination_capacity, '\0', stdin) <= 0) { result = 2; break; }
    int fd = open(source, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    struct stat info;
    if (fd < 0 || fstat(fd, &info) != 0 || !S_ISREG(info.st_mode)) {
      if (fd >= 0) close(fd);
      fprintf(stderr, "Source must remain a regular file: %s\n", source);
      result = 1; break;
    }
    int cloned = fclonefileat(fd, AT_FDCWD, destination, CLONE_ACL | CLONE_NOFOLLOW_ANY);
    int clone_error = errno;
    close(fd);
    if (cloned != 0) {
      fprintf(stderr, "Forced CoW clone failed: %s: %s\n", destination, strerror(clone_error));
      result = 1; break;
    }
  }
  if (ferror(stdin)) result = 2;
  free(source); free(destination);
  return result;
}
