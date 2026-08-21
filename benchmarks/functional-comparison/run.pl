use strict;
use warnings;
use File::Copy qw(copy);
use File::Path qw(make_path remove_tree);
use Time::HiRes qw(time);

my $root = $ENV{BENCH_ROOT} || '/bench';
my $work = "$root/.docker-work";
my $compile_runs = 100;
my $compile_warmups = 3;
my $runtime_runs = 100;
my $runtime_warmups = 5;

sub stats {
    my (@values) = @_;
    my $count = scalar @values;
    my $mean = 0;
    $mean += $_ for @values;
    $mean /= $count;
    my $variance = 0;
    $variance += ($_ - $mean) ** 2 for @values;
    $variance /= $count - 1 if $count > 1;
    return ($mean, sqrt($variance));
}

sub timed_system {
    my (@command) = @_;
    my $started = time;
    system(@command) == 0 or die "command failed: @command\n";
    return (time - $started) * 1000.0;
}

sub timed_quiet_run {
    my ($executable) = @_;
    open my $saved_stdout, '>&', \*STDOUT or die "dup stdout: $!";
    open STDOUT, '>', '/dev/null' or die "redirect stdout: $!";
    my $elapsed = timed_system($executable);
    open STDOUT, '>&', $saved_stdout or die "restore stdout: $!";
    return $elapsed;
}

sub benchmark {
    my ($name, $extension, $compile_command) = @_;
    my @compile_samples;
    my $last_executable;
    for my $index (0 .. $compile_warmups + $compile_runs - 1) {
        my $directory = "$work/$name/$index";
        make_path($directory);
        my $source = "$directory/program.$extension";
        copy("$root/scalar-control.$extension", $source) or die "copy source: $!";
        my $executable = "$directory/program";
        my @command = $compile_command->($source, $executable, $directory);
        my $elapsed = timed_system(@command);
        push @compile_samples, $elapsed if $index >= $compile_warmups;
        $last_executable = $executable;
    }

    my @runtime_samples;
    for my $index (0 .. $runtime_warmups + $runtime_runs - 1) {
        my $elapsed = timed_quiet_run($last_executable);
        push @runtime_samples, $elapsed if $index >= $runtime_warmups;
    }
    my ($compile_mean, $compile_std) = stats(@compile_samples);
    my ($runtime_mean, $runtime_std) = stats(@runtime_samples);
    my $value = `$last_executable`;
    chomp $value;
    printf "%s,%.6f,%.6f,%.6f,%.6f,%s\n",
        $name, $compile_mean, $compile_std, $runtime_mean, $runtime_std, $value;
}

remove_tree($work) if -d $work;
make_path($work);
print "language,compile_mean_ms,compile_std_ms,runtime_mean_ms,runtime_std_ms,value\n";

benchmark('c', 'c', sub {
    my ($source, $executable) = @_;
    return ('clang', '-O3', '-march=native', '-std=c17', $source, '-o', $executable);
});

benchmark('haskell', 'hs', sub {
    my ($source, $executable, $directory) = @_;
    return ('ghc', '-O2', '-fforce-recomp', '-v0', '-odir', $directory, '-hidir', $directory, '-o', $executable, $source);
});

benchmark('ocaml', 'ml', sub {
    my ($source, $executable) = @_;
    return ('ocamlopt', '-O3', '-o', $executable, $source);
});
